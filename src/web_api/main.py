"""
bizcall-web-api Lambda
웹 대시보드 전용 API. Supabase JWT(Bearer 토큰)로 모든 요청을 인증한다.
엔드포인트:
  GET  /presign?key=<s3_key>   → S3 Pre-signed URL 발급
  POST /permanent              → 녹음 파일 영구 저장 (S3 복사 + DB 업데이트)
  GET  /prompts                → 프롬프트 템플릿 목록 조회
  PUT  /prompts/<key>          → 프롬프트 템플릿 수정
"""

import json
import os
import jwt
import boto3
import urllib.request
from supabase import create_client, Client

# ── 환경변수 ──────────────────────────────────────────────────────────────
SUPABASE_URL        = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]   # service_role key
S3_BUCKET           = os.environ["S3_BUCKET"]             # bizcall-recordings
S3_PERMANENT_BUCKET = os.environ.get("S3_PERMANENT_BUCKET", "bizcall-permanent")
AWS_REGION          = "ap-northeast-2"
PRESIGN_EXPIRES_SEC = 3600  # 1시간

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
s3_client = boto3.client("s3", region_name=AWS_REGION)


# ── 공통 헬퍼 ─────────────────────────────────────────────────────────────
_jwks_cache: dict | None = None

def _get_jwks() -> dict:
    """
    Supabase JWKS 엔드포인트에서 공개키 목록을 가져온다.
    Lambda 컨테이너 수명 동안 캐싱해서 매 요청마다 HTTP 호출하지 않도록 한다.
    """
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache

    jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    with urllib.request.urlopen(jwks_url, timeout=5) as res:
        _jwks_cache = json.loads(res.read())
    return _jwks_cache


def cors_headers() -> dict:
    """Cloudflare Pages 도메인에서 오는 요청을 허용하는 CORS 헤더."""
    origin = os.environ.get("ALLOWED_ORIGIN", "*")
    return {
        "Access-Control-Allow-Origin":  origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
    }


def response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            **cors_headers(),
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def options_response() -> dict:
    """OPTIONS preflight 응답 (CORS 핸드셰이크)"""
    return {
        "statusCode": 204,
        "headers": cors_headers(),
        "body": "",
    }


# ── JWT 인증 ──────────────────────────────────────────────────────────────
def verify_supabase_jwt(event: dict) -> dict | None:
    """
    Authorization: Bearer <token> 헤더의 Supabase JWT를 검증한다.
    현재 프로젝트가 ECC (P-256) 알고리즘을 사용하므로 JWKS 공개키로 검증.
    """
    headers = event.get("headers") or {}
    auth_header = headers.get("authorization") or headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[len("Bearer "):]

    try:
        jwks = _get_jwks()
        public_key = jwt.algorithms.ECAlgorithm.from_jwk(
            json.dumps(jwks["keys"][0])
        )
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            audience="authenticated",
        )
        return payload
    except jwt.ExpiredSignatureError:
        print("JWT 만료")
        return None
    except Exception as e:
        print(f"JWT 검증 실패: {e}")
        return None


# ── /presign ──────────────────────────────────────────────────────────────
def handle_presign(event: dict) -> dict:
    """
    GET /presign?key=recordings/xxxxx.m4a
    S3 키를 받아 Pre-signed URL(GET, 1시간 유효)을 반환한다.
    """
    params = event.get("queryStringParameters") or {}
    s3_key = params.get("key", "").strip()

    if not s3_key:
        return response(400, {"error": "key 파라미터가 필요합니다"})

    if not s3_key.startswith("recordings/"):
        return response(403, {"error": "허용되지 않은 S3 경로입니다"})

    if ".." in s3_key:
        return response(403, {"error": "허용되지 않은 S3 경로입니다"})

    try:
        presigned_url = s3_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": S3_BUCKET, "Key": s3_key},
            ExpiresIn=PRESIGN_EXPIRES_SEC,
        )
        return response(200, {"url": presigned_url})
    except Exception as e:
        print(f"presign 생성 오류: {e}")
        return response(500, {"error": "URL 발급에 실패했습니다"})


# ── /permanent ────────────────────────────────────────────────────────────
def handle_permanent(event: dict) -> dict:
    """
    POST /permanent
    Body: { "voc_id": "<uuid>", "s3_key": "recordings/xxxxx.m4a" }

    1. bizcall-recordings → bizcall-permanent 로 S3 객체 복사
    2. voc_records.is_permanent = true 로 DB 업데이트
    """
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "잘못된 요청 형식입니다"})

    voc_id = body.get("voc_id", "").strip()
    s3_key = body.get("s3_key", "").strip()

    if not voc_id or not s3_key:
        return response(400, {"error": "voc_id와 s3_key가 필요합니다"})

    if not s3_key.startswith("recordings/"):
        return response(403, {"error": "허용되지 않은 S3 경로입니다"})
    if ".." in s3_key:
        return response(403, {"error": "허용되지 않은 S3 경로입니다"})

    try:
        s3_client.copy_object(
            CopySource={"Bucket": S3_BUCKET, "Key": s3_key},
            Bucket=S3_PERMANENT_BUCKET,
            Key=s3_key,
        )
        print(f"S3 복사 완료: {S3_BUCKET}/{s3_key} → {S3_PERMANENT_BUCKET}/{s3_key}")
    except Exception as e:
        print(f"S3 복사 오류: {e}")
        return response(500, {"error": "파일 복사에 실패했습니다"})

    try:
        supabase.from_("voc_records").update({"is_permanent": True}).eq("id", voc_id).execute()
        print(f"DB 업데이트 완료: voc_id={voc_id}")
    except Exception as e:
        print(f"DB 업데이트 오류: {e}")
        return response(500, {"error": "DB 업데이트에 실패했습니다"})

    return response(200, {"success": True, "message": "영구 저장 완료"})


# ── /prompts ──────────────────────────────────────────────────────────────
def handle_get_prompts(event: dict) -> dict:
    """
    GET /prompts
    prompt_templates 전체 목록 반환 (is_active 포함).
    """
    try:
        res = supabase.table("prompt_templates") \
            .select("id, key, label, content, is_active, updated_at, updated_by") \
            .order("key") \
            .execute()
        return response(200, {"prompts": res.data or []})
    except Exception as e:
        print(f"프롬프트 조회 오류: {e}")
        return response(500, {"error": "프롬프트 조회에 실패했습니다"})


def handle_put_prompt(event: dict, prompt_key: str, user_email: str) -> dict:
    """
    PUT /prompts/<key>
    Body: { "content": "수정할 프롬프트 내용", "is_active": true }

    content 또는 is_active 중 하나만 있어도 처리.
    updated_by에 요청한 관리자 이메일 기록.
    """
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "잘못된 요청 형식입니다"})

    # 업데이트할 필드 구성
    update_payload: dict = {"updated_by": user_email}

    if "content" in body:
        content = body["content"]
        if not isinstance(content, str) or not content.strip():
            return response(400, {"error": "content는 비어있을 수 없습니다"})
        update_payload["content"] = content.strip()

    if "is_active" in body:
        if not isinstance(body["is_active"], bool):
            return response(400, {"error": "is_active는 boolean 값이어야 합니다"})
        update_payload["is_active"] = body["is_active"]

    if len(update_payload) == 1:
        # updated_by만 있으면 실제 변경 없음
        return response(400, {"error": "content 또는 is_active 중 하나는 필요합니다"})

    try:
        res = supabase.table("prompt_templates") \
            .update(update_payload) \
            .eq("key", prompt_key) \
            .execute()

        if not res.data:
            return response(404, {"error": f"프롬프트 키를 찾을 수 없습니다: {prompt_key}"})

        print(f"프롬프트 수정 완료: key={prompt_key}, by={user_email}")
        return response(200, {"success": True, "prompt": res.data[0]})
    except Exception as e:
        print(f"프롬프트 수정 오류: {e}")
        return response(500, {"error": "프롬프트 수정에 실패했습니다"})


# ── Lambda 핸들러 ─────────────────────────────────────────────────────────
def lambda_handler(event, context):
    print("bizcall-web-api event:", json.dumps(event))

    # HTTP API (payload v2) vs REST API (payload v1) 양쪽 호환
    request_context = event.get("requestContext", {})
    http_info = request_context.get("http", {})

    http_method = (
        http_info.get("method")
        or event.get("httpMethod", "")
    ).upper()

    path = (
        event.get("rawPath")
        or event.get("path", "")
    )

    # OPTIONS preflight는 인증 없이 즉시 응답
    if http_method == "OPTIONS":
        return options_response()

    # 모든 실 요청은 JWT 인증 필수
    jwt_payload = verify_supabase_jwt(event)
    if jwt_payload is None:
        return response(401, {"error": "인증이 필요합니다"})

    user_email = jwt_payload.get("email", "unknown")

    # ── 라우팅 ────────────────────────────────────────────────────────────
    if path == "/presign" and http_method == "GET":
        return handle_presign(event)

    if path == "/permanent" and http_method == "POST":
        return handle_permanent(event)

    if path == "/prompts" and http_method == "GET":
        return handle_get_prompts(event)

    # PUT /prompts/{key} 처리
    if path.startswith("/prompts/") and http_method == "PUT":
        prompt_key = path[len("/prompts/"):]
        if not prompt_key:
            return response(400, {"error": "프롬프트 key가 필요합니다"})
        return handle_put_prompt(event, prompt_key, user_email)

    return response(404, {"error": "존재하지 않는 엔드포인트입니다"})
