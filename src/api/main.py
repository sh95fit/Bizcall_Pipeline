import json
import os
import psycopg2
import boto3

# 환경변수
DB_HOST = os.environ["DB_HOST"]
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]
S3_BUCKET = os.environ["S3_BUCKET"]
S3_UPLOAD_ROLE_ARN = os.environ["S3_UPLOAD_ROLE_ARN"]
AWS_REGION = "ap-northeast-2"

CREDENTIALS_DURATION_SEC = 3600

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        port=5432,
        connect_timeout=5
    )

def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False)
    }

def handle_register(body):
    token = body.get("token", "").strip()
    device_id = body.get("device_id", "").strip()

    if not token or not device_id:
        return response(400, {"error": "token과 device_id는 필수입니다"})

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            "SELECT id, name, is_active FROM phones WHERE token = %s",
            (token,)
        )
        row = cur.fetchone()

        if not row:
            return response(401, {"error": "유효하지 않은 토큰입니다"})

        phone_id, name, is_active = row

        if not is_active:
            return response(403, {"error": "비활성화된 업무폰입니다"})

        cur.execute(
            """
            UPDATE phones
            SET last_seen_at = NOW(), device_id = %s
            WHERE id = %s
            """,
            (device_id, str(phone_id))
        )
        conn.commit()
        cur.close()
        conn.close()

        return response(200, {
            "phone_id": str(phone_id),
            "name": name,
            "is_active": is_active
        })

    except Exception as e:
        print(f"handle_register error: {e}")
        return response(500, {"error": "서버 오류가 발생했습니다"})


def handle_credentials(body):
    phone_id = body.get("phone_id", "").strip()
    token = body.get("token", "").strip()

    if not phone_id or not token:
        return response(400, {"error": "phone_id와 token은 필수입니다"})

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            "SELECT is_active FROM phones WHERE id = %s AND token = %s",
            (phone_id, token)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return response(401, {"error": "인증 정보가 올바르지 않습니다"})

        is_active = row[0]
        if not is_active:
            return response(403, {"error": "비활성화된 업무폰입니다"})

    except Exception as e:
        print(f"handle_credentials db error: {e}")
        return response(500, {"error": "서버 오류가 발생했습니다"})

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

    if path == "/phones/credentials" and http_method in ("GET", "POST"):
        return handle_credentials(body)

    return response(404, {"error": "존재하지 않는 엔드포인트입니다"})
