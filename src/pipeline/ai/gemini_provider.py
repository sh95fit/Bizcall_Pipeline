import json
import os
import re
import time
from google import genai
from google.genai import types
from .base import AIProvider

# ── 코드 내장 기본값 (DB 프롬프트 없을 때 폴백) ─────────────────────────────
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
    '- false이면 반드시 빈 문자열("")을 반환하세요.'
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
FILE_READY_TIMEOUT_S  = 60
FILE_READY_INTERVAL_S = 2

# ── 재시도 설정 ────────────────────────────────────────────────────────────────
# generate_content()만 재시도 대상 (파일 업로드는 1회만 수행)
# 최초 1회 + 재시도 2회 = 총 3회 시도
# 429(Rate Limit), 5xx(서버 오류)만 재시도 대상 / 400·401·403은 즉시 실패
AI_MAX_RETRIES     = 2
AI_RETRY_DELAYS    = [10, 20]                    # 1차 실패 후 10s, 2차 실패 후 20s
AI_RETRYABLE_CODES = {429, 500, 502, 503, 504}

# ── Thinking 설정 ──────────────────────────────────────────────────────────────
# thinking_level 은 3.x 모델 전용 파라미터 (2.5 이하 계열에는 적용 불가)
# 3.x 모델 감지: 모델명에서 주 버전 숫자가 3 이상인 경우
#
# 환경변수 GEMINI_THINKING_LEVEL 로 런타임 제어 가능
#   - 미설정 시 코드 기본값 "low" 적용
#   - 3.6 Flash 지원: minimal, low, medium, high
#   - 3.7 Flash 지원: minimal, low, medium, high
#   - 3.8 Flash 지원: low, medium, high  (minimal 없음)
#
# 통화 분류·요약은 단순 구조화 작업(Simple task)에 해당하므로
# Google 공식 권장에 따라 기본값 "low" 설정
# (비용 최적화: minimal 지원 모델에서는 GEMINI_THINKING_LEVEL=minimal 로 절감 가능)
THINKING_LEVEL_DEFAULT = "low"

# 3.x 모델 버전 감지용 정규식
# 예: gemini-3.6-flash, gemini-3.8-flash → 주 버전 "3" 추출
_MODEL_VERSION_RE = re.compile(r"gemini-(\d+)\.")


class GeminiAIProvider(AIProvider):
    def __init__(self):
        self.client = genai.Client(api_key=os.environ["AI_API_KEY"])
        # 코드 기본값: gemini-3.6-flash
        # 환경변수 GEMINI_MODEL 로 런타임 교체 가능
        self.model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
        # 환경변수 GEMINI_THINKING_LEVEL 로 런타임 제어
        # 미설정 시 THINKING_LEVEL_DEFAULT("low") 적용
        self.thinking_level = os.environ.get("GEMINI_THINKING_LEVEL", THINKING_LEVEL_DEFAULT)
        print(f"GeminiAIProvider 초기화: model={self.model}, thinking_level={self.thinking_level}")

    def supports_audio(self) -> bool:
        return True

    # ── 모델 버전 감지 ────────────────────────────────────────────────────────

    def _is_gemini_3x(self) -> bool:
        """
        현재 모델이 Gemini 3.x 계열인지 확인.
        thinking_level 파라미터는 3.x 전용이므로 적용 전 반드시 체크.

        예)
          gemini-3.6-flash → True
          gemini-3.8-flash → True
          gemini-2.5-flash → False
        """
        match = _MODEL_VERSION_RE.search(self.model)
        if match:
            return int(match.group(1)) >= 3
        return False

    def _build_thinking_config(self) -> types.GenerateContentConfig | None:
        """
        3.x 모델일 때만 ThinkingConfig 포함한 GenerateContentConfig 반환.
        2.x 이하 모델이면 None 반환 → generate_content 에 config 미전달.

        thinking_level 유효성은 API 호출 시 Gemini 서버가 검증.
        잘못된 값이면 400 오류 → _extract_status_code 에서 재시도 불가로 처리.
        """
        if not self._is_gemini_3x():
            return None
        return types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level=self.thinking_level)
        )

    # ── 프롬프트 빌더 ─────────────────────────────────────────────────────────

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
        category_list  = "\n".join(lines) if lines else "- 기타: 분류 불명확한 통화"
        category_guide = self._get_prompt(prompts, "category_guide", DEFAULT_CATEGORY_GUIDE)
        return f"[카테고리 목록]\n{category_list}\n\n[카테고리 분류 원칙]\n{category_guide}"

    def _build_text_prompt(self, transcript: str, categories: list, prompts: dict) -> str:
        business_context = self._get_prompt(prompts, "business_context", DEFAULT_BUSINESS_CONTEXT)
        sentiment_guide  = self._get_prompt(prompts, "sentiment_guide",  DEFAULT_SENTIMENT_GUIDE)
        action_guide     = self._get_prompt(prompts, "action_guide",     DEFAULT_ACTION_GUIDE)
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
        sentiment_guide  = self._get_prompt(prompts, "sentiment_guide",  DEFAULT_SENTIMENT_GUIDE)
        action_guide     = self._get_prompt(prompts, "action_guide",     DEFAULT_ACTION_GUIDE)
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

    # ── File API ──────────────────────────────────────────────────────────────

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
            elapsed  += FILE_READY_INTERVAL_S
            uploaded  = self.client.files.get(name=uploaded.name)

        print(f"파일 ACTIVE 확인: {uploaded.name}")
        return uploaded

    # ── 재시도 포함 generate_content ──────────────────────────────────────────

    def _generate_with_retry(self, **kwargs) -> object:
        """
        generate_content()를 재시도 포함해서 호출.
        파일 업로드는 호출 전에 1회만 완료된 상태이므로 generate만 재시도.

        thinking_level 적용 규칙:
          - 3.x 모델: GEMINI_THINKING_LEVEL 환경변수 값 사용 (기본 "low")
          - 2.x 이하: config 미전달 (thinking_level 파라미터 미지원)
          - 외부에서 config 를 직접 전달한 경우: 그대로 사용 (오버라이드 가능)

        Returns:
            generate_content 응답 객체
        Raises:
            Exception : 재시도 횟수 초과 또는 재시도 불가 오류
                        → analyze() → main.py except 에서 failed 상태로 DB 저장
        """
        # config 미전달 시 모델 버전에 따라 자동 설정
        if "config" not in kwargs:
            thinking_config = self._build_thinking_config()
            if thinking_config is not None:
                kwargs["config"] = thinking_config
                print(f"thinking_level 적용: {self.thinking_level} (model={self.model})")
            else:
                print(f"thinking_level 미적용: 2.x 이하 모델 (model={self.model})")

        last_exception = None

        for attempt in range(AI_MAX_RETRIES + 1):  # 0, 1, 2
            try:
                if attempt > 0:
                    delay = AI_RETRY_DELAYS[attempt - 1]
                    print(f"AI 재시도 {attempt}/{AI_MAX_RETRIES} — {delay}초 대기 중...")
                    time.sleep(delay)

                return self.client.models.generate_content(**kwargs)  # 성공 시 즉시 반환

            except Exception as e:
                status_code    = self._extract_status_code(e)
                last_exception = e

                if status_code not in AI_RETRYABLE_CODES:
                    # 400, 401, 403 등 재시도해도 무의미한 오류 → 즉시 raise
                    print(f"AI 재시도 불가 오류 (HTTP {status_code}): {e}")
                    raise

                print(f"AI 오류 (HTTP {status_code}, 시도 {attempt + 1}/{AI_MAX_RETRIES + 1}): {e}")

                if attempt == AI_MAX_RETRIES:
                    print("AI 최대 재시도 횟수 초과 → 실패 처리")
                    raise  # main.py except 로 전파

        raise last_exception  # 안전망 (정상 흐름에서 도달하지 않음)

    @staticmethod
    def _extract_status_code(e: Exception) -> int | None:
        """
        예외에서 HTTP 상태코드 추출 (google-genai SDK 구조 대응)
        google.genai APIError      → e.status_code 속성 보유
        google.api_core 계열 오류  → e.code 속성 보유 (int)
        그 외 예외는 문자열 파싱으로 fallback
        """
        if hasattr(e, "status_code"):
            return e.status_code
        if hasattr(e, "code") and isinstance(e.code, int):
            return e.code
        # 문자열 파싱 fallback
        msg = str(e)
        for code in AI_RETRYABLE_CODES:
            if str(code) in msg:
                return code
        return None

    # ── 메인 분석 진입점 ──────────────────────────────────────────────────────

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
        Raises:
            Exception : _generate_with_retry 최종 실패
                        → main.py except 에서 failed 상태로 DB 저장
        """
        if prompts is None:
            prompts = {}

        if transcript:
            # ── 텍스트 분석 모드 (STT 결과 있음) ─────────────────────────────
            print("Gemini 텍스트 분석 모드")
            result = self._generate_with_retry(
                model=self.model,
                contents=self._build_text_prompt(transcript, categories, prompts),
            )
            return transcript, json.loads(result.text.strip())

        elif file_path:
            # ── 오디오 File API 처리 모드 (STT_PROVIDER=skip) ─────────────────
            print("Gemini 오디오 File API 처리 모드")
            uploaded_file = None
            try:
                # 업로드는 1회만 수행 — generate 실패 시 재시도해도 재업로드 없음
                uploaded_file = self._upload_audio_file(file_path)

                print("generate_content 호출 시작")
                result = self._generate_with_retry(
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
                # 성공·실패·재시도 완료 후 항상 업로드 파일 삭제
                if uploaded_file is not None:
                    try:
                        self.client.files.delete(name=uploaded_file.name)
                        print(f"Gemini 업로드 파일 삭제 완료: {uploaded_file.name}")
                    except Exception as e:
                        print(f"Gemini 업로드 파일 삭제 실패 (무시): {e}")
        else:
            raise ValueError("transcript 또는 file_path 중 하나는 필수입니다.")
