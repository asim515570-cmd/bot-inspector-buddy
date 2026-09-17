CREATE TABLE IF NOT EXISTS public.bot_rate_limits (
  telegram_id BIGINT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ
);
GRANT ALL ON public.bot_rate_limits TO service_role;
ALTER TABLE public.bot_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON public.admin_activity (created_at DESC);
GRANT ALL ON public.admin_activity TO service_role;
ALTER TABLE public.admin_activity ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.bot_rate_check(p_telegram_id BIGINT, p_limit INTEGER DEFAULT 20, p_window_seconds INTEGER DEFAULT 10, p_cooldown_seconds INTEGER DEFAULT 30)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.bot_rate_limits%ROWTYPE;
BEGIN
  INSERT INTO public.bot_rate_limits (telegram_id, window_start, hits)
  VALUES (p_telegram_id, now(), 0)
  ON CONFLICT (telegram_id) DO NOTHING;

  SELECT * INTO row FROM public.bot_rate_limits WHERE telegram_id = p_telegram_id FOR UPDATE;

  IF row.blocked_until IS NOT NULL AND row.blocked_until > now() THEN
    RETURN FALSE;
  END IF;

  IF row.window_start < now() - make_interval(secs => p_window_seconds) THEN
    UPDATE public.bot_rate_limits
      SET window_start = now(), hits = 1, blocked_until = NULL
      WHERE telegram_id = p_telegram_id;
    RETURN TRUE;
  END IF;

  IF row.hits + 1 > p_limit THEN
    UPDATE public.bot_rate_limits
      SET blocked_until = now() + make_interval(secs => p_cooldown_seconds), hits = 0, window_start = now()
      WHERE telegram_id = p_telegram_id;
    RETURN FALSE;
  END IF;

  UPDATE public.bot_rate_limits SET hits = row.hits + 1 WHERE telegram_id = p_telegram_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.bot_rate_check(BIGINT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_rate_check(BIGINT, INTEGER, INTEGER, INTEGER) TO service_role;