from abc import ABC, abstractmethod


class AIProvider(ABC):
    @abstractmethod
    def analyze(self, categories: list, transcript: str | None = None, file_path: str | None = None) -> tuple[str | None, dict]:
        """
        분석 결과 반환: (transcript, analysis_dict)
        - transcript: STT 결과 텍스트 (오디오 직접 처리 시 AI가 생성)
        - analysis_dict: 분석 결과
        """
        pass

    def supports_audio(self) -> bool:
        """오디오 직접 처리 지원 여부"""
        return False