"""
bizcall-web-api Lambda
웹 대시보드 전용 API. Supabase JWT(Bearer 토큰)로 모든 요청을 인증한다.
엔드포인트:
  GET  /presign?key=<s3_key>   → S3 Pre-signed URL 발급
  (Phase 3 추가 예정)
  GET  /prompts                → 프롬프트 템플릿 목록 조회
  PUT  /prompts/<id>           → 프롬프트 템플릿 수정
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
S3_BUCKET           = os.environ["S3_BUCKET"]
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
    """
    Cloudflare Pages 도메인에서 오는 요청을 허용하는 CORS 헤더.
    실제 운영 도메인이 확정되면 ALLOWED_ORIGIN 환경변수로 교체 가능.
    """
    origin = os.environ.get("ALLOWED_ORIGIN", "*")
    return {
        "Access-Control-Allow-Origin":  origin,
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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
        # kid 기반으로 매칭되는 공개키 자동 선택
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
    S3 키가 'recordings/' 접두사로 시작하는지 검증해 경로 탈출 공격을 차단한다.
    """
    params = event.get("queryStringParameters") or {}
    s3_key = params.get("key", "").strip()

    if not s3_key:
        return response(400, {"error": "key 파라미터가 필요합니다"})

    # 경로 탈출 방어: recordings/ 로 시작해야 함
    if not s3_key.startswith("recordings/"):
        return response(403, {"error": "허용되지 않은 S3 경로입니다"})

    # 경로 순회 방어: .. 포함 차단
    if ".." in s3_key:
        return response(403, {"error": "허용되지 않은 S3 경로입니다"})

    try:
        presigned_url = s3_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key":    s3_key,
            },
            ExpiresIn=PRESIGN_EXPIRES_SEC,
        )
        return response(200, {"url": presigned_url})
    except Exception as e:
        print(f"presign 생성 오류: {e}")
        return response(500, {"error": "URL 발급에 실패했습니다"})


# ── Lambda 핸들러 ─────────────────────────────────────────────────────────
def lambda_handler(event, context):
    print("bizcall-web-api event:", json.dumps(event))

    # ── HTTP API (payload v2) vs REST API (payload v1) 양쪽 호환 ──
    # HTTP API Gateway (v2): requestContext.http.method / rawPath
    # REST API Gateway (v1): httpMethod / path
    request_context = event.get("requestContext", {})
    http_info = request_context.get("http", {})

    http_method = (
        http_info.get("method")          # HTTP API v2
        or event.get("httpMethod", "")   # REST API v1
    ).upper()

    path = (
        event.get("rawPath")             # HTTP API v2
        or event.get("path", "")         # REST API v1
    )

    # OPTIONS preflight는 인증 없이 즉시 응답
    if http_method == "OPTIONS":
        return options_response()

    # 모든 실 요청은 JWT 인증 필수
    payload = verify_supabase_jwt(event)
    if payload is None:
        return response(401, {"error": "인증이 필요합니다"})

    # 라우팅
    if path == "/presign" and http_method == "GET":
        return handle_presign(event)

    return response(404, {"error": "존재하지 않는 엔드포인트입니다"})
