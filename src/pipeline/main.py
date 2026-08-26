import json
import os
import tempfile
from datetime import datetime
import boto3
from supabase import create_client
from stt import get_stt_provider
from ai import get_ai_provider

s3 = boto3.client("s3")
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])


def parse_s3_key(key: str) -> dict:
    try:
        filename = key.split("/")[-1].replace(".m4a", "")
        parts = filename.split("_")
        timestamp_str = parts[-1]
        caller_number = parts[-2]
        direction = parts[-3]
        phone_id = "_".join(parts[:-3])
        call_started_at = datetime.strptime(timestamp_str, "%Y%m%d%H%M%S").isoformat()
        return {
            "phone_id": phone_id,
            "direction": direction,
            "caller_number": caller_number,
            "call_started_at": call_started_at,
        }
    except Exception as e:
        print(f"parse_s3_key failed: {e}")
        return {}


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
    res = supabase.table("categories") \
        .select("id, name") \
        .is_("parent_id", None) \
        .eq("is_active", True) \
        .order("sort_order") \
        .execute()
    return res.data


def is_duplicate_insert_error(e: Exception) -> bool:
    """
    PostgreSQL 유니크 제약 위반(23505)만 정확히 판별.
    문자열 매칭 대신 error code만 사용해 오탐 방지.
    supabase-py는 PostgREST 에러를 Exception 문자열로 전달하므로
    '23505' 포함 여부로 판별.
    """
    return "23505" in str(e)


def save_completed_record(payload: dict) -> bool:
    """
    voc_records completed insert.
    Returns:
        True  : insert 성공
        False : 유니크 제약 위반(23505) → 이미 처리된 파일, 정상 skip
    Raises:
        Exception : 그 외 DB 오류 → Lambda 실패 → SQS 재시도 → DLQ
    """
    try:
        supabase.table("voc_records").insert(payload).execute()
        return True
    except Exception as e:
        if is_duplicate_insert_error(e):
            print(f"중복 insert 차단 (23505 유니크 제약): {payload.get('s3_key')}")
            return False
        raise


def save_silent_record(meta: dict, phone: dict, s3_key: str):
    """
    무음 감지 시 최소 정보만 기록.
    silent_skipped는 유니크 제약 대상 외 → 중복 insert 허용.
    """
    try:
        supabase.table("voc_records").insert({
            "phone_id": phone.get("id"),
            "phone_name": phone.get("name"),
            "caller_number": meta.get("caller_number"),
            "call_direction": meta.get("direction"),
            "call_started_at": meta.get("call_started_at"),
            "s3_key": s3_key,
            "processing_status": "silent_skipped",
        }).execute()
        print("Saved to voc_records: silent_skipped")
    except Exception as e:
        print(f"save_silent_record 오류: {e}")


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
        body = json.loads(record["body"])
        s3_event = body.get("Records", [{}])[0]
        bucket = s3_event["s3"]["bucket"]["name"]
        key = s3_event["s3"]["object"]["key"]
        print(f"Processing s3://{bucket}/{key}")

        meta = parse_s3_key(key)
        print("Parsed metadata:", meta)

        phone = get_phone_record(meta.get("phone_id", ""))
        print("Phone record:", phone)

        tmp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tmp:
                s3.download_fileobj(bucket, key, tmp)
                tmp_path = tmp.name

            transcript = None
            analysis = None

            # ── STT 단계 ──────────────────────────────────────
            if stt:
                transcript = stt.transcribe(tmp_path)
                if transcript is None:
                    print("STT 무음 감지 → AI/DB 단계 생략")
                    save_silent_record(meta, phone, key)
                    continue
                print(f"Transcript ({len(transcript)}자): {transcript[:200]}")
            else:
                print("STT_PROVIDER=skip → AI 오디오 직접 처리 모드")

            # ── AI 분석 단계 ──────────────────────────────────
            categories = get_active_categories()
            transcript, analysis = ai.analyze(
                categories=categories,
                transcript=transcript,
                file_path=tmp_path if not transcript else None,
            )

            if transcript is None or analysis is None:
                print("AI 무음 감지 → DB 단계 생략")
                save_silent_record(meta, phone, key)
                continue

            print("Analysis:", json.dumps(analysis, ensure_ascii=False))

            # ── DB 저장 단계 ──────────────────────────────────
            category_id = next(
                (c["id"] for c in categories if c["name"] == analysis.get("category")),
                None
            )

            inserted = save_completed_record({
                "phone_id": phone.get("id"),
                "phone_name": phone.get("name"),
                "caller_number": meta.get("caller_number"),
                "call_direction": meta.get("direction"),
                "call_started_at": meta.get("call_started_at"),
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
            # inserted=False 는 중복 정상 skip → SQS 메시지 삭제됨

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
                print(f"tmp 파일 삭제 완료: {tmp_path}")

    return {"statusCode": 200, "body": "bizcall-pipeline completed"}
