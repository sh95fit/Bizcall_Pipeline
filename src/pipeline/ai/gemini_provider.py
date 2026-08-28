import json
import os
import time
from google import genai
from google.genai import types
from .base import AIProvider

# ── 코드 내장 기본값 (DB 프롬프트 없을 때 폴백) ───────────────────────────
DEFAULT_BUSINESS_CONTEXT = (
    "이 음성 통화는 중소기업 임직원이 사용하는 업무용 전화 서비스에서 녹음된 실제 고객 응대 내용입니다.\n"
    "통화 상대방은 고객, 협력사, 또는 내부 관계자일 수 있습니다.\n"
    "분석 목적은 통화 품질 관리, VOC(Voice of Customer) 수집, 후속 조치 도출입니다.\n"
    "반드시 통화 내용만을 근거로 분석하며, 추측이나 과도한 해석은 금지합니다."
)

DEFAULT_CATEGORY_GUIDE = (
    "분류 원칙:\n"
    "1. 통화의 주된 목적과 가장 일치하는 카테고리 하나를 선택하세요.\n"
    "2. 여러 주제가 언급된 경우 가장 비중이 크거나 먼저 언급된 주제를 기준으로 선택하세요.\n"
    "3. 위 목록에 해당하지 않거나 판단이 어려운 경우 반드시 '기타'를 선택하세요.\n"
    "4. 절대 null이나 빈 값을 반환하지 마세요."
)

DEFAULT_SENTIMENT_GUIDE = (
    "감성 분류 기준:\n"
    "- positive: 고객이 만족, 감사, 긍정적 반응을 보이는 경우\n"
    "- neutral: 단순 문의, 정보 전달 위주로 감정 표현이 없는 경우\n"
    "- negative: 불만, 항의, 실망, 재촉 등 부정적 감정을 표현하는 경우\n\n"
    "판단 기준:\n"
    "- 통화 종료 시점의 감성에 더 높은 가중치를 부여하세요.\n"
    "- 고객 발화만을 기준으로 판단하고, 상담원 발화는 참고만 하세요.\n"
    "- 말투가 불명확하면 발화 내용의 의미로 판단하세요."
)

DEFAULT_ACTION_GUIDE = (
    "action_required = true 판단 기준:\n"
    "- 고객이 특정 처리나 답변을 명시적으로 요청한 경우\n"
    "- 상담원이 확인 후 연락하겠다고 약속한 경우\n"
    "- 불만 또는 민원이 해결되지 않고 통화가 종료된 경우\n"
    "- 환불, 교환, 수리, 방문 등 물리적 조치가 필요한 경우\n\n"
    "action_required = false 판단 기준:\n"
    "- 단순 정보 전달로 통화가 완전히 마무리된 경우\n"
    "- 고객이 만족하며 통화를 종료한 경우\n\n"
    "action_memo 작성 기준:\n"
    "- action_required가 true일 때만 구체적으로 작성하세요.\n"
    "- 누가, 무엇을, 언제까지 해야 하는지 간결하게 작성하세요.\n"
    "- false이면 반드시 빈 문자열(\"\")을 반환하세요."
)

OUTPUT_CAUTION = (
    "주의사항:\n"
    "- 반드시 JSON만 출력하세요.\n"
    "- 마크다운 코드블록(```) 없이 순수 JSON만 출력하세요.\n"
    "- category는 반드시 제공된 카테고리 목록 중 하나여야 합니다. null 반환 금지.\n"
    "- 분류가 어려우면 반드시 '기타'를 선택하세요.\n"
    "- summary는 반드시 한국어로 작성하세요.\n"
    "- sentiment는 반드시 positive / neutral / negative 중 하나여야 합니다."
)

MIN_TRANSCRIPT_LENGTH = 10
FILE_READY_TIMEOUT_S = 60
FILE_READY_INTERVAL_S = 2


class GeminiAIProvider(AIProvider):
    def __init__(self):
        self.client = genai.Client(api_key=os.environ["AI_API_KEY"])
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

    def supports_audio(self) -> bool:
        return True

    def _get_prompt(self, prompts: dict, key: str, default: str) -> str:
        """DB 프롬프트에서 key를 찾아 반환. 없거나 비어있으면 기본값 반환."""
        value = prompts.get(key, "").strip()
        return value if value else default

    def _build_category_section(self, categories: list, prompts: dict) -> str:
        """카테고리 목록 + description + 카테고리 가이드 조합."""
        lines = []
        for c in categories:
            name = c["name"]
            desc = (c.get("description") or "").strip()
            if desc:
                lines.append(f"- {name}: {desc}")
            else:
                lines.append(f"- {name}")

        category_list = "\n".join(lines) if lines else "- 기타: 분류 불명확한 통화"
        category_guide = self._get_prompt(prompts, "category_guide", DEFAULT_CATEGORY_GUIDE)

        return f"[카테고리 목록]\n{category_list}\n\n[카테고리 분류 원칙]\n{category_guide}"

    def _build_text_prompt(self, transcript: str, categories: list, prompts: dict) -> str:
        business_context = self._get_prompt(prompts, "business_context", DEFAULT_BUSINESS_CONTEXT)
        sentiment_guide = self._get_prompt(prompts, "sentiment_guide", DEFAULT_SENTIMENT_GUIDE)
        action_guide = self._get_prompt(prompts, "action_guide", DEFAULT_ACTION_GUIDE)
        category_section = self._build_category_section(categories, prompts)

        return (
            "당신은 비즈니스 전화 통화를 분석하는 전문 AI입니다.\n"
            f"{business_context}\n\n"
            "아래 통화 내용을 분석하여 JSON 형식으로 결과를 반환하세요.\n\n"
            f"[통화 내용]\n{transcript}\n\n"
            f"{category_section}\n\n"
            f"[감성 분석 가이드]\n{sentiment_guide}\n\n"
            f"[액션 가이드]\n{action_guide}\n\n"
            "[출력 형식]\n"
            "{\n"
            '  "category": "카테고리명 (위 목록 중 하나, null 금지)",\n'
            '  "summary": "통화 내용을 3줄로 요약. 핵심 내용 / 고객 요청사항 / 처리 결과 순 (한국어)",\n'
            '  "sentiment": "positive | neutral | negative 중 하나",\n'
            '  "keywords": ["핵심 키워드 최대 5개"],\n'
            '  "action_required": true 또는 false,\n'
            '  "action_memo": "후속 조치 내용 (없으면 빈 문자열)"\n'
            "}\n\n"
            f"{OUTPUT_CAUTION}"
        )

    def _build_audio_prompt(self, categories: list, prompts: dict) -> str:
        business_context = self._get_prompt(prompts, "business_context", DEFAULT_BUSINESS_CONTEXT)
        sentiment_guide = self._get_prompt(prompts, "sentiment_guide", DEFAULT_SENTIMENT_GUIDE)
        action_guide = self._get_prompt(prompts, "action_guide", DEFAULT_ACTION_GUIDE)
        category_section = self._build_category_section(categories, prompts)

        return (
            "당신은 비즈니스 전화 통화를 분석하는 전문 AI입니다.\n"
            f"{business_context}\n\n"
            "첨부된 오디오 파일은 실제 비즈니스 전화 통화 녹음입니다.\n"
            "오디오를 직접 듣고 전체 내용을 텍스트로 변환한 뒤, 아래 항목을 분석하여 JSON 형식으로 반환하세요.\n\n"
            f"{category_section}\n\n"
            f"[감성 분석 가이드]\n{sentiment_guide}\n\n"
            f"[액션 가이드]\n{action_guide}\n\n"
            "[출력 형식]\n"
            "{\n"
            '  "transcript": "오디오의 전체 통화 내용을 텍스트로 변환 (한국어, 발화 내용 전체)",\n'
            '  "category": "카테고리명 (위 목록 중 하나, null 금지)",\n'
            '  "summary": "통화 내용을 3줄로 요약. 핵심 내용 / 고객 요청사항 / 처리 결과 순 (한국어)",\n'
            '  "sentiment": "positive | neutral | negative 중 하나",\n'
            '  "keywords": ["핵심 키워드 최대 5개"],\n'
            '  "action_required": true 또는 false,\n'
            '  "action_memo": "후속 조치 내용 (없으면 빈 문자열)"\n'
            "}\n\n"
            f"{OUTPUT_CAUTION}\n"
            "- transcript는 오디오에서 들리는 내용을 최대한 정확하게 변환하세요."
        )

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
        prompts: dict = None,
        transcript: str | None = None,
        file_path: str | None = None,
    ) -> tuple[str | None, dict | None]:
        """
        prompts: load_prompt_templates()에서 전달된 DB 프롬프트 dict.
                 None 또는 빈 dict면 코드 내장 기본값 사용.
        """
        if prompts is None:
            prompts = {}

        if transcript:
            print("Gemini 텍스트 분석 모드")
            result = self.client.models.generate_content(
                model=self.model,
                contents=self._build_text_prompt(transcript, categories, prompts),
            )
            return transcript, json.loads(result.text.strip())

        elif file_path:
            print("Gemini 오디오 File API 처리 모드")
            uploaded_file = None
            try:
                uploaded_file = self._upload_audio_file(file_path)

                print("generate_content 호출 시작")
                result = self.client.models.generate_content(
                    model=self.model,
                    contents=[
                        uploaded_file,
                        self._build_audio_prompt(categories, prompts),
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
