-- voc_delete_logs는 소프트 딜리트(voc_records.is_deleted) 도입으로 역할 중복
-- 어떤 서비스에서도 참조하지 않으므로 제거
DROP TABLE IF EXISTS voc_delete_logs;
