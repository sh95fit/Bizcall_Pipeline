import os
from .base import STTProvider


def get_stt_provider() -> STTProvider | None:
    """
    STT_PROVIDER 환경변수에 따라 제공자 반환
    - groq: Groq Whisper 사용
    - skip: STT 생략 (AI 오디오 직접 처리)
    - whisper_lambda: 셀프호스팅 (추후 구현)
    - 미설정: groq 기본값
    """
    provider = os.environ.get("STT_PROVIDER", "groq").strip().lower()

    if provider == "groq":
        from .groq_provider import GroqSTTProvider
        return GroqSTTProvider()
    elif provider == "skip":
        print("STT_PROVIDER=skip: STT 단계 생략")
        return None
    elif provider == "whisper_lambda":
        raise NotImplementedError("whisper_lambda STT provider is not yet implemented.")
    else:
        raise ValueError(f"Unknown STT_PROVIDER: {provider}")
