-- lunchlab.me 도메인 계정만 로그인 허용하는 Hook 함수
CREATE OR REPLACE FUNCTION public.restrict_to_lunchlab_domain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := current_setting('request.jwt.claims', true)::jsonb->>'email';
  IF v_email NOT LIKE '%@lunchlab.me' THEN
    RAISE EXCEPTION 'Access denied: only lunchlab.me accounts are allowed';
  END IF;
END;

$$;
