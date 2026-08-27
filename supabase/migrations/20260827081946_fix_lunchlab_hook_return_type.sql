-- 기존 함수 삭제 후 재생성 (반환 타입 변경은 DROP 필요)
DROP FUNCTION IF EXISTS public.restrict_to_lunchlab_domain();

CREATE FUNCTION public.restrict_to_lunchlab_domain()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := (current_setting('request.jwt.claims', true)::jsonb)->>'email';

  IF v_email NOT LIKE '%@lunchlab.me' THEN
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
