import json
import os
import tempfile
from datetime import datetime
import boto3
from groq import Groq
from google import genai
from supabase import create_client

s3 = boto3.client("s3")
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
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


def get_active_categories():
    res = supabase.table("categories").select("id, name").is_("parent_id", None).eq("is_active", True).order("sort_order").execute()
    return res.data


def transcribe_audio(file_path: str) -> str:
    file_size = os.path.getsize(file_path)
    print(f"Audio file size: {file_size} bytes")
    if file_size == 0:
        raise ValueError("Downloaded audio file is empty.")
    with open(file_path, "rb") as f:
        result = groq_client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=(os.path.basename(file_path), f, "audio/mp4"),
            language="ko",
        )
    return result.text


def analyze_with_gemini(transcript: str, categories: list) -> dict:
    category_list = ", ".join([c["name"] for c in categories])
    prompt = f"""다음은 비즈니스 전화 통화 내용입니다.

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

    response = gemini_client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt,
    )
    return json.loads(response.text.strip())


def lambda_handler(event, context):
    print("bizcall-pipeline received event:", json.dumps(event))

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
        transcript = transcribe_audio(tmp_path)
        print("Transcript:", transcript[:200])

        # Gemini 분석
        categories = get_active_categories()
        analysis = analyze_with_gemini(transcript, categories)
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
