import os
from .base import AIProvider


def get_ai_provider() -> AIProvider:
    """
    AI_PROVIDER 환경변수에 따라 제공자 반환
    - gemini: Google Gemini (기본값, 오디오 직접 처리 지원)
    - claude: Anthropic Claude (추후 구현)
    - groq: Groq LLM (추후 구현)
    """
    provider = os.environ.get("AI_PROVIDER", "gemini").strip().lower()

    if provider == "gemini":
        from .gemini_provider import GeminiAIProvider
        return GeminiAIProvider()
    elif provider == "claude":
        raise NotImplementedError("Claude AI provider is not yet implemented.")
    elif provider == "groq":
        raise NotImplementedError("Groq AI provider is not yet implemented.")
    else:
        raise ValueError(f"Unknown AI_PROVIDER: {provider}")