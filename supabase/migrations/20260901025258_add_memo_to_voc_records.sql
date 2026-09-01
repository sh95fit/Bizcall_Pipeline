-- voc_records 테이블에 운영자 메모 컬럼 추가
-- memo: VOC 상세 페이지에서 운영자가 자유롭게 입력/수정/삭제하는 특이사항 메모
ALTER TABLE voc_records
  ADD COLUMN IF NOT EXISTS memo TEXT DEFAULT NULL;

COMMENT ON COLUMN voc_records.memo IS '운영자 특이사항 메모 (상세 페이지에서 인라인 편집)';