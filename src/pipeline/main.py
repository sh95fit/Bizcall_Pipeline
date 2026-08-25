import json
import os
import tempfile
from datetime import datetime
import boto3
from supabase import create_client

s3 = boto3.client("s3")
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

STT_PROVIDER = os.environ.get("STT_PROVIDER", "groq")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "gemini")


# ──────────────────────────────────────────
# STT
# ──────────────────────────────────────────
def transcribe_groq(file_path: str) -> str:
    from groq import Groq
    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    file_size = os.path.getsize(file_path)
    print(f"Audio file size: {file_size} bytes")
    if file_size == 0:
        raise ValueError("Downloaded audio file is empty.")
    with open(file_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=(os.path.basename(file_path), f, "audio/mp4"),
            language="ko",
        )
    return result.text


def transcribe(file_path: str) -> str | None:
    """STT_PROVIDER 환경변수에 따라 STT 제공자 선택"""
    if STT_PROVIDER == "groq":
        return transcribe_groq(file_path)
    elif STT_PROVIDER == "whisper_lambda":
        raise NotImplementedError("whisper_lambda STT provider is not yet implemented.")
    else:
        raise ValueError(f"Unknown STT_PROVIDER: {STT_PROVIDER}")


# ──────────────────────────────────────────
# AI 분석
# ──────────────────────────────────────────
def build_prompt(transcript: str, categories: list) -> str:
    category_list = ", ".join([c["name"] for c in categories])
    return f"""다음은 비즈니스 전화 통화 내용입니다.

[통화 내용]
{transcript}

아래 항목을 JSON 형식으로 분석하세요:
- category: 반드시 다음 중 하나만 선택 [{category_list}]
- summary: 통화 내용 3줄 요약 (한국어)
- sentiment: 다음 중 하나 [positive, neutral, negative]
- keywords: 핵심 키워드 최대 5개 (배열)
- action_required: 후속 조치 필요 여부 (true/false)
- action_memo: action_required가 true일 경우 필요한 조치 내용, 아니면 빈 문자열

반드시 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON만."""


def analyze_gemini(transcript: str, categories: list) -> dict:
    from google import genai
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    # Gemini가 오디오를 직접 처리하는 경우 STT 스킵 가능 (추후 STEP 21)
    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=build_prompt(transcript, categories),
    )
    return json.loads(response.text.strip())


def analyze_claude(transcript: str, categories: list) -> dict:
    raise NotImplementedError("Claude AI provider is not yet implemented.")


def analyze_groq(transcript: str, categories: list) -> dict:
    raise NotImplementedError("Groq AI provider is not yet implemented.")


def analyze(transcript: str, categories: list) -> dict:
    """AI_PROVIDER 환경변수에 따라 AI 제공자 선택"""
    if AI_PROVIDER == "gemini":
        return analyze_gemini(transcript, categories)
    elif AI_PROVIDER == "claude":
        return analyze_claude(transcript, categories)
    elif AI_PROVIDER == "groq":
        return analyze_groq(transcript, categories)
    else:
        raise ValueError(f"Unknown AI_PROVIDER: {AI_PROVIDER}")


# ──────────────────────────────────────────
# 유틸
# ──────────────────────────────────────────
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


# ──────────────────────────────────────────
# Lambda 핸들러
# ──────────────────────────────────────────
def lambda_handler(event, context):
    print("bizcall-pipeline received event:", json.dumps(event))
    print(f"STT_PROVIDER={STT_PROVIDER}, AI_PROVIDER={AI_PROVIDER}")

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
        transcript = transcribe(tmp_path)
        print("Transcript:", transcript[:200] if transcript else "None")

        # AI 분석
        categories = get_active_categories()
        analysis = analyze(transcript, categories)
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