import json
import os
import boto3
from supabase import create_client, Client

# 환경변수
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
S3_BUCKET = os.environ["S3_BUCKET"]
S3_UPLOAD_ROLE_ARN = os.environ["S3_UPLOAD_ROLE_ARN"]
AWS_REGION = "ap-northeast-2"

CREDENTIALS_DURATION_SEC = 3600

# Supabase 클라이언트 초기화 (Lambda 컨테이너 재사용 시 재생성 방지)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False)
    }


def handle_register(body):
    """
    POST /phones/register
    body: { "token": "...", "device_id": "..." }
    → phones 테이블에서 token 조회 → phone_id, name, is_active 반환
    """
    token = body.get("token", "").strip()
    device_id = body.get("device_id", "").strip()

    if not token or not device_id:
        return response(400, {"error": "token과 device_id는 필수입니다"})

    try:
        # token으로 phones 테이블 조회
        result = supabase.table("phones") \
            .select("id, name, is_active") \
            .eq("token", token) \
            .single() \
            .execute()

        if not result.data:
            return response(401, {"error": "유효하지 않은 토큰입니다"})

        phone = result.data
        phone_id = phone["id"]
        name = phone["name"]
        is_active = phone["is_active"]

        if not is_active:
            return response(403, {"error": "비활성화된 업무폰입니다"})

        # last_seen_at 및 device_id 업데이트
        supabase.table("phones") \
            .update({"last_seen_at": "now()", "device_id": device_id}) \
            .eq("id", phone_id) \
            .execute()

        return response(200, {
            "phone_id": phone_id,
            "name": name,
            "is_active": is_active
        })

    except Exception as e:
        print(f"handle_register error: {e}")
        return response(500, {"error": "서버 오류가 발생했습니다"})


def handle_credentials(body):
    """
    POST /phones/credentials
    body: { "phone_id": "...", "token": "..." }
    → token + phone_id 검증 → STS 임시 자격증명 발급
    """
    phone_id = body.get("phone_id", "").strip()
    token = body.get("token", "").strip()

    if not phone_id or not token:
        return response(400, {"error": "phone_id와 token은 필수입니다"})

    try:
        # phone_id + token 동시 검증
        result = supabase.table("phones") \
            .select("is_active") \
            .eq("id", phone_id) \
            .eq("token", token) \
            .single() \
            .execute()

        if not result.data:
            return response(401, {"error": "인증 정보가 올바르지 않습니다"})

        is_active = result.data["is_active"]
        if not is_active:
            return response(403, {"error": "비활성화된 업무폰입니다"})

    except Exception as e:
        print(f"handle_credentials db error: {e}")
        return response(500, {"error": "서버 오류가 발생했습니다"})

    # STS 임시 자격증명 발급
    try:
        sts = boto3.client("sts", region_name=AWS_REGION)

        session_policy = json.dumps({
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": "s3:PutObject",
                "Resource": f"arn:aws:s3:::{S3_BUCKET}/recordings/*"
            }]
        })

        creds = sts.assume_role(
            RoleArn=S3_UPLOAD_ROLE_ARN,
            RoleSessionName=f"bizcall-{phone_id[:8]}",
            DurationSeconds=CREDENTIALS_DURATION_SEC,
            ExternalId="bizcall-upload-session",
            Policy=session_policy
        )["Credentials"]

        return response(200, {
            "access_key_id": creds["AccessKeyId"],
            "secret_access_key": creds["SecretAccessKey"],
            "session_token": creds["SessionToken"],
            "expiration": creds["Expiration"].isoformat(),
            "bucket": S3_BUCKET,
            "region": AWS_REGION
        })

    except Exception as e:
        print(f"handle_credentials sts error: {e}")
        return response(500, {"error": "자격증명 발급 실패"})


def lambda_handler(event, context):
    print("bizcall-api event:", json.dumps(event))

    http_method = event.get("httpMethod", "")
    path = event.get("path", "")

    raw_body = event.get("body", "{}")
    try:
        body = json.loads(raw_body) if raw_body else {}
    except Exception:
        body = {}

    if path == "/phones/register" and http_method == "POST":
        return handle_register(body)

    if path == "/phones/credentials" and http_method == "POST":
        return handle_credentials(body)

    return response(404, {"error": "존재하지 않는 엔드포인트입니다"})
 