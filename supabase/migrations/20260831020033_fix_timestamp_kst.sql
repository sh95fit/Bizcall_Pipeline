-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 기존 voc_records 타임스탬프 KST 보정
--
-- 문제: pipeline이 timezone 없는 KST 문자열을 insert하면
--       Supabase(UTC 기준 DB)가 UTC로 잘못 해석하여
--       실제보다 9시간 앞선 값으로 저장됨
--
-- 조건: +09:00 offset 보정이 적용된 pipeline 배포 이전 데이터
--       즉, 현재 저장된 값이 실제 KST보다 9시간 빠른 상태
--
-- 조치: call_started_at, call_ended_at 에서 9시간을 차감하여
--       올바른 KST 값으로 재저장
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. 보정 전 데이터 확인용 (실행 전 검증)
-- SELECT id, call_started_at, call_ended_at
-- FROM voc_records
-- WHERE call_started_at IS NOT NULL
-- ORDER BY created_at DESC
-- LIMIT 20;

-- 2. 실제 보정 실행
UPDATE voc_records
SET
  call_started_at = call_started_at - INTERVAL '9 hours',
  call_ended_at   = CASE
                      WHEN call_ended_at IS NOT NULL
                      THEN call_ended_at - INTERVAL '9 hours'
                      ELSE NULL
                    END
WHERE
  -- pipeline +09:00 보정 배포 이전에 생성된 레코드만 대상
  -- created_at은 NOW()로 저장되어 UTC 정상값이므로 기준으로 사용 가능
  -- 아래 날짜를 실제 pipeline 배포 완료 시점으로 교체하세요
  created_at < '2026-08-31T00:00:00+00:00'
  AND call_started_at IS NOT NULL;

-- 3. 보정 후 확인용
-- SELECT id, call_started_at, call_ended_at
-- FROM voc_records
-- ORDER BY created_at DESC
-- LIMIT 20;
