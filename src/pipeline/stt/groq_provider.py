import os
from groq import Groq
from .base import STTProvider


class GroqSTTProvider(STTProvider):
    def __init__(self):
        self.client = Groq(api_key=os.environ["STT_API_KEY"])

    def transcribe(self, file_path: str) -> str:
        file_size = os.path.getsize(file_path)
        print(f"Audio file size: {file_size} bytes")
        if file_size == 0:
            raise ValueError("Downloaded audio file is empty.")
        with open(file_path, "rb") as f:
            result = self.client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=(os.path.basename(file_path), f, "audio/mp4"),
                language="ko",
            )
        return result.text