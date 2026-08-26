import json
import os
import boto3
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
S3_BUCKET = os.environ["S3_BUCKET"]
S3_UPLOAD_ROLE_ARN = os.environ["S3_UPLOAD_ROLE_ARN"]
AWS_REGION = "ap-northeast-2"
CREDENTIALS_DURATION_SEC = 3600

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
    - 토큰은 최초 1회만 유효 (is_used=false 인 경우만 등록 허용)
    - 등록 완료 시 is_used=true, device_id 저장, registered_at 기록
    - 동일 device_id 재등록(앱 재설치)은 허용
    """
    token = body.get("token", "").strip()
    device_id = body.get("device_id", "").strip()

    if not token or not device_id:
        return response(400, {"error": "token과 device_id는 필수입니다"})

    try:
        result = supabase.table("phones") \
            .select("id, name, is_active, is_used, device_id") \
            .eq("token", token) \
            .single() \
            .execute()
    except Exception as e:
        print(f"handle_register DB 조회 오류: {e}")
        return response(401, {"error": "유효하지 않은 토큰입니다"})

    if not result.data:
        return response(401, {"error": "유효하지 않은 토큰입니다"})

    phone = result.data

    if not phone["is_active"]:
        return response(403, {"error": "비활성화된 업무폰입니다"})

    existing_device_id = phone.get("device_id") or ""
    is_used = phone.get("is_used", False)

    # 이미 사용된 토큰 + 다른 기기 → 차단
    if is_used and existing_device_id and existing_device_id != device_id:
        return response(409, {
            "error": "이미 다른 기기에 등록된 토큰입니다",
            "code": "TOKEN_ALREADY_BOUND"
        })

    # 최초 등록 시에만 토큰 소진 처리
    update_data = {"last_seen_at": "now()"}
    if not is_used:
        update_data["device_id"] = device_id
        update_data["is_used"] = True
        update_data["registered_at"] = "now()"

    try:
        supabase.table("phones") \
            .update(update_data) \
            .eq("id", phone["id"]) \
            .execute()
    except Exception as e:
        print(f"handle_register DB 업데이트 오류: {e}")
        return response(500, {"error": "서버 오류"})

    return response(200, {
        "phone_id": phone["id"],
        "name": phone["name"],
        "is_active": phone["is_active"]
    })


def handle_credentials(body):
    """
    POST /phones/credentials
    - 등록 완료 후 토큰 없이 phone_id + device_id 로만 인증
    - STS 임시 자격증명 발급 (1시간 유효)
    """
    phone_id = body.get("phone_id", "").strip()
    device_id = body.get("device_id", "").strip()

    if not phone_id or not device_id:
        return response(400, {"error": "phone_id와 device_id는 필수입니다"})

    try:
        result = supabase.table("phones") \
            .select("id, is_active, device_id") \
            .eq("id", phone_id) \
            .eq("device_id", device_id) \
            .eq("is_active", True) \
            .single() \
            .execute()
    except Exception as e:
        print(f"handle_credentials DB 조회 오류: {e}")
        return response(401, {"error": "인증 정보가 올바르지 않습니다"})

    if not result.data:
        return response(401, {"error": "인증 정보가 올바르지 않습니다"})

    # last_seen_at 갱신
    try:
        supabase.table("phones") \
            .update({"last_seen_at": "now()"}) \
            .eq("id", phone_id) \
            .execute()
    except Exception as e:
        print(f"last_seen_at 업데이트 오류: {e}")

    # STS 임시 자격증명 발급
    try:
        sts = boto3.client("sts", region_name=AWS_REGION)
        creds = sts.assume_role(
            RoleArn=S3_UPLOAD_ROLE_ARN,
            RoleSessionName=f"bizcall-{phone_id[:8]}",
            ExternalId="bizcall-upload-session",
            DurationSeconds=CREDENTIALS_DURATION_SEC,
        )["Credentials"]

        return response(200, {
            "access_key_id": creds["AccessKeyId"],
            "secret_access_key": creds["SecretAccessKey"],
            "session_token": creds["SessionToken"],
            "expiration": creds["Expiration"].isoformat(),
            "bucket": S3_BUCKET,
            "region": AWS_REGION,
        })
    except Exception as e:
        print(f"STS assume_role 오류: {e}")
        return response(500, {"error": "자격증명 발급 실패"})


def lambda_handler(event, context):
    print("bizcall-api event:", json.dumps(event))

    http_method = event.get("httpMethod", "")
    path = event.get("path", "")

    raw_body = event.get("body", "{}") or "{}"
    try:
        body = json.loads(raw_body)
    except Exception:
        body = {}

    if path == "/phones/register" and http_method == "POST":
        return handle_register(body)

    if path == "/phones/credentials" and http_method == "POST":
        return handle_credentials(body)

    return response(404, {"error": "존재하지 않는 엔드포인트입니다"})
