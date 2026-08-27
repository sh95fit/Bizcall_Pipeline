-- 함수 시그니처 수정 (jsonb 입력 인자 추가)
DROP FUNCTION IF EXISTS public.restrict_to_lunchlab_domain();

CREATE FUNCTION public.restrict_to_lunchlab_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := event->'claims'->>'email';

  IF v_email IS NULL OR v_email NOT LIKE '%@lunchlab.me' THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Access denied: only lunchlab.me accounts are allowed'
      )
    );
  END IF;

  RETURN jsonb_build_object('decision', 'continue');
END;

$$;
