import json
import os
import tempfile
from datetime import datetime, timezone
import boto3
from supabase import create_client
from stt import get_stt_provider
from ai import get_ai_provider

s3 = boto3.client("s3")
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

# ── 프롬프트 캐시 (Lambda 콜드 스타트 시 1회 로딩) ──────────────────────────
_prompt_cache: dict | None = None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [추가] timezone 없는 KST 문자열에 +09:00 명시
# 앱이 S3 메타데이터에 timezone 없이 KST 시각을 저장하기 때문에
# Supabase(timestamptz)가 UTC로 오해하지 않도록 insert 직전 보정.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def as_kst_isoformat(ts: str | None) -> str | None:
    """
    timezone 정보가 없는 KST 문자열에 +09:00을 붙여 반환.
    이미 timezone이 포함된 문자열이면 그대로 반환.

    예)
      "2026-08-31T09:57:11"        → "2026-08-31T09:57:11+09:00"
      "2026-08-31T09:57:11+09:00"  → "2026-08-31T09:57:11+09:00"  (변환 없음)
      None                         → None
    """
    if not ts:
        return None
    # 이미 timezone 포함 여부 확인 (Z, +HH:MM, -HH:MM)
    if ts.endswith("Z") or "+" in ts[10:] or "-" in ts[10:]:
        return ts
    return ts + "+09:00"


def parse_s3_key(key: str) -> dict:
    try:
        filename = key.split("/")[-1].replace(".m4a", "")
        parts = filename.split("_")
        timestamp_str = parts[-1]
        caller_number = parts[-2]
        direction = parts[-3]
        phone_id = "_".join(parts[:-3])
        # [수정] isoformat() 결과에 +09:00 즉시 적용
        call_started_at = datetime.strptime(timestamp_str, "%Y%m%d%H%M%S").isoformat() + "+09:00"
        return {
            "phone_id": phone_id,
            "direction": direction,
            "caller_number": caller_number,
            "call_started_at": call_started_at,
        }
    except Exception as e:
        print(f"parse_s3_key failed: {e}")
        return {}


def get_call_timing_from_s3(bucket: str, key: str) -> dict:
    """
    앱이 S3 업로드 시 ObjectMetadata에 저장한 커스텀 헤더를 읽어 반환.

    반환 키:
        call_ended_at : ISO 문자열 또는 None
        duration_sec  : int 또는 None

    실패 시 빈 값 반환 → DB에 null로 저장 (파이프라인 중단 없음)
    """
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
        meta = head.get("Metadata", {})

        call_ended_at = meta.get("call-end-time")
        duration_str = meta.get("call-duration-sec")

        return {
            # [수정] 앱이 timezone 없는 KST 문자열로 업로드하므로 +09:00 보정
            "call_ended_at": as_kst_isoformat(call_ended_at),
            "duration_sec": int(duration_str) if duration_str and duration_str.isdigit() else None,
        }
    except Exception as e:
        print(f"get_call_timing_from_s3 실패 (null 폴백): {e}")
        return {"call_ended_at": None, "duration_sec": None}


def get_phone_record(phone_id: str) -> dict:
    try:
        res = supabase.table("phones") \
            .select("id, name") \
            .eq("id", phone_id) \
            .eq("is_active", True) \
            .single() \
            .execute()
        return res.data or {}
    except Exception as e:
        print(f"get_phone_record failed: {e}")
        return {}


def get_active_categories() -> list:
    """
    활성 상위 카테고리 목록 조회.
    description 포함하여 AI가 카테고리를 더 정확히 인식하도록 함.
    """
    res = supabase.table("categories") \
        .select("id, name, description") \
        .is_("parent_id", None) \
        .eq("is_active", True) \
        .order("sort_order") \
        .execute()
    return res.data


def load_prompt_templates() -> dict:
    """
    prompt_templates 테이블에서 is_active=true인 프롬프트를 로딩.
    Lambda 컨테이너 수명 동안 캐싱 (콜드 스타트 시 1회만 조회).
    DB 조회 실패 시 빈 dict 반환 → AI 코드에서 코드 내장 기본값 사용.
    """
    global _prompt_cache
    if _prompt_cache is not None:
        return _prompt_cache

    try:
        res = supabase.table("prompt_templates") \
            .select("key, content") \
            .eq("is_active", True) \
            .execute()
        _prompt_cache = {row["key"]: row["content"] for row in (res.data or [])}
        print(f"프롬프트 로딩 완료: {list(_prompt_cache.keys())}")
    except Exception as e:
        print(f"프롬프트 로딩 실패 (기본값 사용): {e}")
        _prompt_cache = {}

    return _prompt_cache


def is_duplicate_insert_error(e: Exception) -> bool:
    return "23505" in str(e)


def save_completed_record(payload: dict) -> bool:
    try:
        supabase.table("voc_records").insert(payload).execute()
        return True
    except Exception as e:
        if is_duplicate_insert_error(e):
            print(f"중복 insert 차단 (23505 유니크 제약): {payload.get('s3_key')}")
            return False
        raise


def save_silent_record(meta: dict, phone: dict, s3_key: str, timing: dict):
    """
    무음 감지 시 최소 정보만 기록.
    timing을 받아 call_ended_at / duration_sec도 함께 저장.
    """
    try:
        supabase.table("voc_records").insert({
            "phone_id": phone.get("id"),
            "phone_name": phone.get("name"),
            "caller_number": meta.get("caller_number"),
            "call_direction": meta.get("direction"),
            "call_started_at": meta.get("call_started_at"),
            "call_ended_at": timing.get("call_ended_at"),
            "duration_sec": timing.get("duration_sec"),
            "s3_key": s3_key,
            "processing_status": "silent_skipped",
        }).execute()
        print("Saved to voc_records: silent_skipped")
    except Exception as e:
        # [추가] silent도 중복 방어
        if is_duplicate_insert_error(e):
            print(f"silent 중복 insert 차단 (23505): {s3_key}")
            return
        print(f"save_silent_record 오류: {e}")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [추가] STT / AI 최종 실패 시 failed 상태로 DB에 기록
# 재시도를 모두 소진한 뒤 main.py except 블록에서 호출됨.
# s3_key, caller_number, call_started_at 등 기본 메타데이터는 보존하여
# 관리자가 VOC 목록에서 원인을 파악하고 필요 시 수동 재처리 가능.
# action_memo 에 오류 메시지를 기록해 실패 원인 추적 지원.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def save_failed_record(meta: dict, phone: dict, s3_key: str, timing: dict, error_msg: str):
    try:
        supabase.table("voc_records").insert({
            "phone_id": phone.get("id"),
            "phone_name": phone.get("name"),
            "caller_number": meta.get("caller_number"),
            "call_direction": meta.get("direction"),
            "call_started_at": meta.get("call_started_at"),
            "call_ended_at": timing.get("call_ended_at"),
            "duration_sec": timing.get("duration_sec"),
            "s3_key": s3_key,
            "transcript": None,
            "summary": None,
            "category_id": None,
            "sentiment": None,
            "keywords": [],
            "action_required": False,
            "action_memo": f"[처리 실패] {error_msg}",
            "processing_status": "failed",
        }).execute()
        print(f"failed 상태로 DB 저장 완료: {s3_key}")
    except Exception as db_err:
        if is_duplicate_insert_error(db_err):
            print(f"failed 중복 insert 차단 (23505): {s3_key}")
            return
        # failed 저장마저 실패해도 Lambda는 정상 종료 (로그만 남김)
        print(f"failed 레코드 DB 저장 실패 (로그만 기록): {db_err}")


def lambda_handler(event, context):
    print("bizcall-pipeline received event:", json.dumps(event))

    stt = get_stt_provider()
    ai = get_ai_provider()

    stt_provider_name = os.environ.get("STT_PROVIDER", "groq")
    ai_provider_name = os.environ.get("AI_PROVIDER", "gemini")
    print(f"STT_PROVIDER={stt_provider_name}, AI_PROVIDER={ai_provider_name}")

    if stt is None and not ai.supports_audio():
        raise ValueError(
            f"STT_PROVIDER=skip이지만 AI_PROVIDER({ai_provider_name})가 "
            f"오디오 직접 처리를 지원하지 않습니다."
        )

    for record in event.get("Records", []):
        # [추가] failed 저장 시 필요한 변수들 루프 상단에서 초기화
        # try 블록 진입 전 오류 발생 시에도 except 에서 안전하게 참조 가능
        key    = ""
        meta   = {}
        phone  = {}
        timing = {}
        tmp_path: str | None = None

        try:
            body = json.loads(record["body"])
            s3_event = body.get("Records", [{}])[0]
            bucket = s3_event["s3"]["bucket"]["name"]
            key = s3_event["s3"]["object"]["key"]
            print(f"Processing s3://{bucket}/{key}")

            meta = parse_s3_key(key)
            print("Parsed metadata:", meta)

            timing = get_call_timing_from_s3(bucket, key)
            print(f"Call timing: end={timing.get('call_ended_at')}, "
                  f"duration={timing.get('duration_sec')}s")

            phone = get_phone_record(meta.get("phone_id", ""))
            print("Phone record:", phone)

            with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tmp:
                s3.download_fileobj(bucket, key, tmp)
                tmp_path = tmp.name

            transcript = None
            analysis = None

            # ── STT 단계 ──────────────────────────────────────────────────
            if stt:
                transcript = stt.transcribe(tmp_path)
                # 재시도 소진 시 예외 raise → 아래 except 로 이동
                if transcript is None:
                    print("STT 무음 감지 → AI/DB 단계 생략")
                    save_silent_record(meta, phone, key, timing)
                    continue
                print(f"Transcript ({len(transcript)}자): {transcript[:200]}")
            else:
                print("STT_PROVIDER=skip → AI 오디오 직접 처리 모드")

            # ── AI 분석 단계 ──────────────────────────────────────────────
            categories = get_active_categories()
            prompts = load_prompt_templates()
            transcript, analysis = ai.analyze(
                categories=categories,
                prompts=prompts,
                transcript=transcript,
                file_path=tmp_path if not transcript else None,
            )
            # 재시도 소진 시 예외 raise → 아래 except 로 이동

            if transcript is None or analysis is None:
                print("AI 무음 감지 → DB 단계 생략")
                save_silent_record(meta, phone, key, timing)
                continue

            print("Analysis:", json.dumps(analysis, ensure_ascii=False))

            # ── DB 저장 단계 ──────────────────────────────────────────────
            category_id = next(
                (c["id"] for c in categories if c["name"] == analysis.get("category")),
                None
            )
            if category_id is None:
                category_id = next(
                    (c["id"] for c in categories if c["name"] == "기타"),
                    None
                )

            inserted = save_completed_record({
                "phone_id": phone.get("id"),
                "phone_name": phone.get("name"),
                "caller_number": meta.get("caller_number"),
                "call_direction": meta.get("direction"),
                "call_started_at": meta.get("call_started_at"),
                "call_ended_at": timing.get("call_ended_at"),
                "duration_sec": timing.get("duration_sec"),
                "s3_key": key,
                "transcript": transcript,
                "summary": analysis.get("summary"),
                "category_id": category_id,
                "sentiment": analysis.get("sentiment"),
                "keywords": analysis.get("keywords", []),
                "action_required": analysis.get("action_required", False),
                "action_memo": analysis.get("action_memo", ""),
                "processing_status": "completed",
            })

            if inserted:
                print("Saved to voc_records: completed")

        except Exception as e:
            # ── [추가] 최종 실패 처리 ─────────────────────────────────────
            # STT / AI 재시도를 모두 소진한 예외가 여기 도달
            # Lambda 는 정상 종료(200) → SQS 재시도 없음
            # failed 레코드를 DB에 남겨 관리자가 VOC 목록에서 확인 가능
            print(f"[FINAL ERROR] {key}: {e}")
            save_failed_record(meta, phone, key, timing, str(e))

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
                print(f"tmp 파일 삭제 완료: {tmp_path}")

    return {"statusCode": 200, "body": "bizcall-pipeline completed"}
