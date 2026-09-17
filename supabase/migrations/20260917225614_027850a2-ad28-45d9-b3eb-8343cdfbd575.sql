-- 1. De-duplicate telegram updates, then enforce uniqueness (replay protection)
DELETE FROM public.telegram_updates t
USING public.telegram_updates keep
WHERE t.update_id IS NOT NULL
  AND keep.update_id = t.update_id
  AND keep.created_at <= t.created_at
  AND keep.id <> t.id;

CREATE UNIQUE INDEX IF NOT EXISTS telegram_updates_update_id_key
  ON public.telegram_updates (update_id) WHERE update_id IS NOT NULL;

-- 2. Data integrity constraints
ALTER TABLE public.products
  ADD CONSTRAINT products_price_nonneg CHECK (price >= 0),
  ADD CONSTRAINT products_sale_price_nonneg CHECK (sale_price IS NULL OR sale_price >= 0),
  ADD CONSTRAINT products_sort_order_range CHECK (sort_order >= 0 AND sort_order <= 9999);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_quantity_range CHECK (quantity >= 1 AND quantity <= 100),
  ADD CONSTRAINT orders_prices_nonneg CHECK (unit_price >= 0 AND total_price >= 0),
  ADD CONSTRAINT orders_status_allowed CHECK (status IN ('pending','paid','delivered','cancelled','refunded'));

ALTER TABLE public.bot_users
  ADD CONSTRAINT bot_users_balance_nonneg CHECK (balance >= 0);

ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT withdrawals_status_allowed CHECK (status IN ('pending','approved','rejected'));

-- 3. Generic server-side rate limiter for sensitive dashboard actions
CREATE TABLE IF NOT EXISTS public.action_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0,
  blocked_until timestamptz
);

GRANT ALL ON public.action_rate_limits TO service_role;
ALTER TABLE public.action_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no public access to action_rate_limits"
  ON public.action_rate_limits FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.action_rate_check(
  p_key text,
  p_limit integer DEFAULT 30,
  p_window_seconds integer DEFAULT 60,
  p_cooldown_seconds integer DEFAULT 120
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.action_rate_limits%ROWTYPE;
BEGIN
  INSERT INTO public.action_rate_limits (key, window_start, hits)
  VALUES (p_key, now(), 0)
  ON CONFLICT (key) DO NOTHING;

  SELECT * INTO r FROM public.action_rate_limits WHERE key = p_key FOR UPDATE;

  IF r.blocked_until IS NOT NULL AND r.blocked_until > now() THEN
    RETURN FALSE;
  END IF;

  IF r.window_start < now() - make_interval(secs => p_window_seconds) THEN
    UPDATE public.action_rate_limits
       SET window_start = now(), hits = 1, blocked_until = NULL
     WHERE key = p_key;
    RETURN TRUE;
  END IF;

  IF r.hits + 1 > p_limit THEN
    UPDATE public.action_rate_limits
       SET blocked_until = now() + make_interval(secs => p_cooldown_seconds), hits = 0, window_start = now()
     WHERE key = p_key;
    RETURN FALSE;
  END IF;

  UPDATE public.action_rate_limits SET hits = r.hits + 1 WHERE key = p_key;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.action_rate_check(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.action_rate_check(text, integer, integer, integer) TO service_role;

CREATE INDEX IF NOT EXISTS admin_activity_action_idx ON public.admin_activity (action, created_at DESC);