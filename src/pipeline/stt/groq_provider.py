import os
import re
import time
from groq import Groq
from .base import STTProvider

# Whisper가 무음에서 자주 생성하는 할루시네이션 패턴 목록
HALLUCINATION_PATTERNS = [
    r"^[\s감사합니다\.\!]*$",                          # "감사합니다" 반복 조합
    r"^(감사합니다[\.\s]*)+$",                         # "감사합니다. 감사합니다." 반복
    r"^시청해\s*주셔서\s*감사합니다\.?$",
    r"^구독과\s*좋아요\s*부탁드립니다\.?$",
    r"^like\s*and\s*subscribe\.?$",
    r"^thank\s+you\.?$",
    r"^thank\s+you\s+for\s+(watching|listening|your\s+time)\.?$",
    r"^MBC\s*뉴스",
    r"^자막\s*제공",
    r"^\s*$",
]

HALLUCINATION_RE = re.compile(
    "|".join(HALLUCINATION_PATTERNS),
    re.IGNORECASE | re.MULTILINE
)

# 유효한 transcript 최소 글자 수 (공백 제외)
MIN_TRANSCRIPT_LENGTH = 10

# ── 재시도 설정 ────────────────────────────────────────────────────────────────
# 최초 1회 + 재시도 2회 = 총 3회 시도
# 429(Rate Limit), 5xx(서버 오류)만 재시도 대상 / 400·401·403은 즉시 실패
STT_MAX_RETRIES     = 2
STT_RETRY_DELAYS    = [5, 10]                    # 1차 실패 후 5s, 2차 실패 후 10s
STT_RETRYABLE_CODES = {429, 500, 502, 503, 504}


class GroqSTTProvider(STTProvider):
    def __init__(self):
        self.client = Groq(api_key=os.environ["STT_API_KEY"])

    def transcribe(self, file_path: str) -> str | None:
        """
        Returns:
            str  : 유효한 transcript
            None : 무음 또는 할루시네이션 감지 시 → AI/DB 단계 생략
        Raises:
            Exception : 재시도 횟수 초과 또는 재시도 불가 오류
                        → main.py except 에서 failed 상태로 DB 저장
        """
        file_size = os.path.getsize(file_path)
        print(f"Audio file size: {file_size} bytes")

        if file_size == 0:
            print("파일 크기 0 → 무음 처리")
            return None

        last_exception = None

        for attempt in range(STT_MAX_RETRIES + 1):  # 0, 1, 2
            try:
                if attempt > 0:
                    delay = STT_RETRY_DELAYS[attempt - 1]
                    print(f"STT 재시도 {attempt}/{STT_MAX_RETRIES} — {delay}초 대기 중...")
                    time.sleep(delay)

                with open(file_path, "rb") as f:
                    result = self.client.audio.transcriptions.create(
                        model="whisper-large-v3-turbo",
                        file=(os.path.basename(file_path), f, "audio/mp4"),
                        language="ko",
                    )

                text = result.text.strip() if result.text else ""
                print(f"Groq STT 원본 결과 (시도 {attempt + 1}): '{text}'")

                if self._is_invalid(text):
                    print(f"무효 transcript 감지 → 무음 처리: '{text}'")
                    return None

                return text  # 성공 시 즉시 반환

            except Exception as e:
                status_code   = self._extract_status_code(e)
                last_exception = e

                if status_code not in STT_RETRYABLE_CODES:
                    # 400, 401, 403 등 재시도해도 무의미한 오류 → 즉시 raise
                    print(f"STT 재시도 불가 오류 (HTTP {status_code}): {e}")
                    raise

                print(f"STT 오류 (HTTP {status_code}, 시도 {attempt + 1}/{STT_MAX_RETRIES + 1}): {e}")

                if attempt == STT_MAX_RETRIES:
                    print("STT 최대 재시도 횟수 초과 → 실패 처리")
                    raise  # main.py except 로 전파

        raise last_exception  # 안전망 (정상 흐름에서 도달하지 않음)

    def _is_invalid(self, text: str) -> bool:
        if not text:
            return True
        # 최소 길이 미달 (공백 제거 후)
        if len(text.replace(" ", "")) < MIN_TRANSCRIPT_LENGTH:
            return True
        # 할루시네이션 패턴 매칭
        if HALLUCINATION_RE.search(text):
            return True
        return False

    @staticmethod
    def _extract_status_code(e: Exception) -> int | None:
        """
        예외에서 HTTP 상태코드 추출 (Groq SDK 구조 대응)
        groq.APIStatusError → e.status_code 속성 보유
        그 외 예외는 문자열 파싱으로 fallback
        """
        if hasattr(e, "status_code"):
            return e.status_code
        # 문자열 파싱 fallback
        msg = str(e)
        for code in STT_RETRYABLE_CODES:
            if str(code) in msg:
                return code
        return None
