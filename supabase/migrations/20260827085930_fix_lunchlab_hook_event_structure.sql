-- Hook event 구조 수정
-- before_user_created event 구조: { "user": { "email": "..." } }
CREATE OR REPLACE FUNCTION public.restrict_to_lunchlab_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  -- event 구조: { "user": { "email": "..." } }
  v_email := event->'user'->>'email';

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
