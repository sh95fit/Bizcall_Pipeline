import os
import re
from groq import Groq
from .base import STTProvider

# Whisper가 무음에서 자주 생성하는 할루시네이션 패턴 목록
HALLUCINATION_PATTERNS = [
    r"^감사합니다\.?$",
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


class GroqSTTProvider(STTProvider):
    def __init__(self):
        self.client = Groq(api_key=os.environ["STT_API_KEY"])

    def transcribe(self, file_path: str) -> str | None:
        """
        Returns:
            str  : 유효한 transcript
            None : 무음 또는 할루시네이션 감지 시 → AI/DB 단계 생략
        """
        file_size = os.path.getsize(file_path)
        print(f"Audio file size: {file_size} bytes")

        if file_size == 0:
            print("파일 크기 0 → 무음 처리")
            return None

        with open(file_path, "rb") as f:
            result = self.client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=(os.path.basename(file_path), f, "audio/mp4"),
                language="ko",
            )

        text = result.text.strip() if result.text else ""
        print(f"Groq STT 원본 결과: '{text}'")

        if self._is_invalid(text):
            print(f"무효 transcript 감지 → 무음 처리: '{text}'")
            return None

        return text

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
