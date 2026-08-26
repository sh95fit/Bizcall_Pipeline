-- SQS 중복 전달 및 S3 이벤트 중복 발행 방지
-- completed 상태 레코드에 한해 s3_key 유니크 보장
-- silent_skipped는 제약 제외 (재처리 허용)
CREATE UNIQUE INDEX IF NOT EXISTS uq_voc_records_s3_key_completed
    ON voc_records (s3_key)
    WHERE processing_status = 'completed';
