from abc import ABC, abstractmethod


class STTProvider(ABC):
    @abstractmethod
    def transcribe(self, file_path: str) -> str:
        """오디오 파일 경로를 받아 텍스트 반환"""
        pass