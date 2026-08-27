CREATE TABLE prompt_templates (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key        VARCHAR(50)  UNIQUE NOT NULL,
    label      VARCHAR(100) NOT NULL,
    content    TEXT         NOT NULL,
    updated_at TIMESTAMPTZ  DEFAULT NOW(),
    updated_by TEXT
);

INSERT INTO prompt_templates (key, label, content) VALUES
('business_context', '비즈니스 컨텍스트',
 '이 음성 통화는 업무용 전화 서비스에서 녹음된 고객 응대 내용입니다.'),
('category_guide', '카테고리 분류 가이드',
 '아래 카테고리 목록을 참고하여 통화 내용을 분류하세요.'),
('sentiment_guide', '감성 분석 가이드',
 '통화 전반의 고객 감성을 positive / neutral / negative 중 하나로 분류하세요.'),
('action_guide', '액션 항목 가이드',
 '통화 내용 중 후속 조치가 필요한 항목이 있으면 action_required를 true로 설정하세요.');