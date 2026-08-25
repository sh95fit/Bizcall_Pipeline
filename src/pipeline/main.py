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


def get_phone_record(device_id: str) -> dict:
    try:
        res = supabase.table("phones").select("id, name").eq("device_id", device_id).eq("is_active", True).single().execute()
        return res.data or {}
    except Exception as e:
        print(f"get_phone_record failed: {e}")
        return {}


def get_active_categories() -> list:
    res = supabase.table("categories").select("id, name").is_("parent_id", None).eq("is_active", True).order("sort_order").execute()
    return res.data


def lambda_handler(event, context):
    print("bizcall-pipeline received event:", json.dumps(event))

    stt = get_stt_provider()
    ai = get_ai_provider()

    stt_provider_name = os.environ.get("STT_PROVIDER", "groq")
    ai_provider_name = os.environ.get("AI_PROVIDER", "gemini")
    print(f"STT_PROVIDER={stt_provider_name}, AI_PROVIDER={ai_provider_name}")

    # STT=skip인데 AI가 오디오 직접 처리 미지원이면 에러
    if stt is None and not ai.supports_audio():
        raise ValueError(
            f"STT_PROVIDER=skip이지만 AI_PROVIDER({ai_provider_name})가 "
            f"오디오 직접 처리를 지원하지 않습니다. STT_PROVIDER를 설정하세요."
        )

    for record in event.get("Records", []):
        body = json.loads(record["body"])
        s3_event = body.get("Records", [{}])[0]
        bucket = s3_event["s3"]["bucket"]["name"]
        key = s3_event["s3"]["object"]["key"]
        print(f"Processing s3://{bucket}/{key}")

        # 파일명 파싱
        meta = parse_s3_key(key)
        print("Parsed metadata:", meta)

        # phone 레코드 조회
        phone = get_phone_record(meta.get("phone_id", ""))
        print("Phone record:", phone)

        # S3 다운로드
        with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tmp:
            s3.download_fileobj(bucket, key, tmp)
            tmp_path = tmp.name

        # STT
        transcript = None
        if stt:
            transcript = stt.transcribe(tmp_path)
            print("Transcript:", transcript[:200])
        else:
            print("STT_PROVIDER=skip → AI 오디오 직접 처리 모드")

        # AI 분석
        categories = get_active_categories()
        transcript, analysis = ai.analyze(
            categories=categories,
            transcript=transcript,
            file_path=tmp_path if not transcript else None,
        )
        print("Analysis:", json.dumps(analysis, ensure_ascii=False))

        # category_id 매핑
        category_id = next(
            (c["id"] for c in categories if c["name"] == analysis.get("category")),
            None
        )

        # Supabase 저장
        supabase.table("voc_records").insert({
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
        }).execute()
        print("Saved to voc_records successfully.")

    return {"statusCode": 200, "body": "bizcall-pipeline completed"}
