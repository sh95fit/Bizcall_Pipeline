import json
import os
import time
from google import genai
from google.genai import types
from .base import AIProvider


CATEGORY_GUIDE = """카테고리 분류 기준:
- 영업: 신규 가입, 상품/서비스 구매, 요금제 변경, 계약 체결 등 매출과 직결된 통화
- 문의: 이용 방법, 절차, 일반 정보 확인 등 단순 정보성 질문
- 항의: 불만 제기, 피해 보상 요구, 서비스 장애 신고 등 부정적 피드백
- 기타: 위 카테고리로 분류하기 어려운 통화"""

SENTIMENT_GUIDE = """감성 분류 기준:
- positive: 고객이 만족하거나 긍정적인 반응을 보이는 통화
- neutral: 감정적 표현이 없거나 중립적인 통화
- negative: 고객이 불만, 불쾌감, 실망감을 표현하는 통화"""

OUTPUT_CAUTION = """주의사항:
- 반드시 JSON만 출력하세요
- 마크다운 코드블록(```) 없이 순수 JSON만 출력하세요
- category는 반드시 제공된 목록 중 하나여야 합니다
- summary는 반드시 한국어로 작성하세요"""

MIN_TRANSCRIPT_LENGTH = 10

FILE_READY_TIMEOUT_S = 60
FILE_READY_INTERVAL_S = 2


class GeminiAIProvider(AIProvider):
    def __init__(self):
        self.client = genai.Client(api_key=os.environ["AI_API_KEY"])
        self.model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")

    def supports_audio(self) -> bool:
        return True

    def _build_category_guide(self, categories: list) -> str:
        category_list = ", ".join([c["name"] for c in categories])
        return f"[카테고리 목록]\n{category_list}\n\n{CATEGORY_GUIDE}"

    def _build_text_prompt(self, transcript: str, categories: list) -> str:
        return f"""당신은 비즈니스 전화 통화를 분석하는 전문 AI입니다.
아래 통화 내용을 분석하여 JSON 형식으로 결과를 반환하세요.

[통화 내용]
{transcript}

{self._build_category_guide(categories)}

{SENTIMENT_GUIDE}

[출력 형식]
{{
  "category": "카테고리명 (위 목록 중 하나만 선택)",
  "summary": "통화 내용을 3줄로 요약. 핵심 내용, 고객 요청사항, 처리 결과 순으로 작성 (한국어)",
  "sentiment": "positive | neutral | negative 중 하나",
  "keywords": ["핵심 키워드 최대 5개"],
  "action_required": true 또는 false,
  "action_memo": "후속 조치가 필요한 경우 구체적인 조치 내용 작성, 불필요하면 빈 문자열"
}}

{OUTPUT_CAUTION}"""

    def _build_audio_prompt(self, categories: list) -> str:
        return f"""당신은 비즈니스 전화 통화를 분석하는 전문 AI입니다.
첨부된 오디오 파일은 실제 비즈니스 전화 통화 녹음입니다.
오디오를 직접 듣고 전체 내용을 텍스트로 변환한 뒤, 아래 항목을 분석하여 JSON 형식으로 반환하세요.

{self._build_category_guide(categories)}

{SENTIMENT_GUIDE}

[출력 형식]
{{
  "transcript": "오디오의 전체 통화 내용을 텍스트로 변환 (한국어, 발화 내용 전체)",
  "category": "카테고리명 (위 목록 중 하나만 선택)",
  "summary": "통화 내용을 3줄로 요약. 핵심 내용, 고객 요청사항, 처리 결과 순으로 작성 (한국어)",
  "sentiment": "positive | neutral | negative 중 하나",
  "keywords": ["핵심 키워드 최대 5개"],
  "action_required": true 또는 false,
  "action_memo": "후속 조치가 필요한 경우 구체적인 조치 내용 작성, 불필요하면 빈 문자열"
}}

{OUTPUT_CAUTION}
- transcript는 오디오에서 들리는 내용을 최대한 정확하게 변환하세요"""

    def _upload_audio_file(self, file_path: str):
        print(f"Gemini File API 업로드 시작: {file_path}")
        uploaded = self.client.files.upload(
            file=file_path,
            config=types.UploadFileConfig(mime_type="audio/mp4")
        )
        print(f"업로드 완료: {uploaded.name} / 상태: {uploaded.state}")

        elapsed = 0
        while uploaded.state.name != "ACTIVE":
            if elapsed >= FILE_READY_TIMEOUT_S:
                raise TimeoutError(
                    f"Gemini 파일 ACTIVE 대기 초과 ({FILE_READY_TIMEOUT_S}s): {uploaded.name}"
                )
            print(f"파일 처리 대기 중... ({elapsed}s)")
            time.sleep(FILE_READY_INTERVAL_S)
            elapsed += FILE_READY_INTERVAL_S
            uploaded = self.client.files.get(name=uploaded.name)

        print(f"파일 ACTIVE 확인: {uploaded.name}")
        return uploaded

    def analyze(
        self,
        categories: list,
        transcript: str | None = None,
        file_path: str | None = None
    ) -> tuple[str | None, dict | None]:

        if transcript:
            print("Gemini 텍스트 분석 모드")
            result = self.client.models.generate_content(
                model=self.model,
                contents=self._build_text_prompt(transcript, categories),
            )
            return transcript, json.loads(result.text.strip())

        elif file_path:
            print("Gemini 오디오 File API 처리 모드")
            uploaded_file = None
            try:
                uploaded_file = self._upload_audio_file(file_path)

                # 공식 문서 권장 방식:
                # 업로드된 파일 객체를 contents 리스트에 직접 전달
                # types.Part/FileData 래핑 없이 SDK가 자동 처리 → AFC 블로킹 없음
                print("generate_content 호출 시작")
                result = self.client.models.generate_content(
                    model=self.model,
                    contents=[
                        uploaded_file,
                        self._build_audio_prompt(categories),
                    ],
                )
                print("generate_content 응답 수신 완료")

                raw_text = result.text.strip()
                print(f"Gemini 응답 원문 (앞 300자): {raw_text[:300]}")

                # 마크다운 코드블록 제거
                if raw_text.startswith("```"):
                    raw_text = raw_text.split("```")[1]
                    if raw_text.startswith("json"):
                        raw_text = raw_text[4:]
                    raw_text = raw_text.strip()

                parsed = json.loads(raw_text)
                extracted_transcript = parsed.pop("transcript", None)

                if not extracted_transcript or \
                   len(extracted_transcript.replace(" ", "")) < MIN_TRANSCRIPT_LENGTH:
                    print("Gemini 오디오 모드 — 유효 transcript 없음 → 무음 처리")
                    return None, None

                return extracted_transcript, parsed

            finally:
                if uploaded_file is not None:
                    try:
                        self.client.files.delete(name=uploaded_file.name)
                        print(f"Gemini 업로드 파일 삭제 완료: {uploaded_file.name}")
                    except Exception as e:
                        print(f"Gemini 업로드 파일 삭제 실패 (무시): {e}")

        else:
            raise ValueError("transcript 또는 file_path 중 하나는 필수입니다.")
