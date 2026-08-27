ALTER TABLE voc_records
    ADD COLUMN is_deleted    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN deleted_at    TIMESTAMPTZ,
    ADD COLUMN deleted_by    TEXT,
    ADD COLUMN delete_reason TEXT;

CREATE INDEX idx_voc_records_is_deleted ON voc_records(is_deleted);