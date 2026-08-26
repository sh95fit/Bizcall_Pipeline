-- voc_delete_logs: 삭제된 VOC 레코드 감사 로그
-- IF NOT EXISTS: 중간에 직접 적용됐을 경우 대비
CREATE TABLE IF NOT EXISTS voc_delete_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voc_id          UUID NOT NULL,
    phone_name      VARCHAR(100),
    caller_number   VARCHAR(50),
    call_started_at TIMESTAMPTZ,
    s3_key          TEXT,
    deleted_by      TEXT,
    deleted_at      TIMESTAMPTZ DEFAULT NOW(),
    reason          TEXT
);
