DROP FUNCTION IF EXISTS public.adjust_bot_user_balance(uuid, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.decide_payment(uuid, boolean);

CREATE FUNCTION public.adjust_bot_user_balance(
  p_bot_user uuid,
  p_delta numeric,
  p_reason text,
  p_order_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_balance numeric(12,2);
BEGIN
  SELECT balance INTO v_balance FROM bot_users WHERE id = p_bot_user FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF v_balance + p_delta < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  UPDATE bot_users SET balance = balance + p_delta WHERE id = p_bot_user
  RETURNING balance INTO v_balance;

  INSERT INTO wallet_transactions (bot_user_id, amount, balance_after, reason, order_id)
  VALUES (p_bot_user, p_delta, v_balance, p_reason, p_order_id);

  RETURN v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_bot_user_balance(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_bot_user_balance(uuid, numeric, text, uuid) TO service_role;

CREATE FUNCTION public.decide_payment(p_order uuid, p_approve boolean)
RETURNS TABLE (payload text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF o IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF o.status <> 'pending' THEN
    RAISE EXCEPTION 'already_decided';
  END IF;

  IF p_approve THEN
    UPDATE orders SET status = 'paid', paid_at = now() WHERE id = p_order;

    RETURN QUERY
      UPDATE stock_items s
         SET status = 'delivered', delivered_at = now()
       WHERE s.order_id = p_order AND s.status = 'reserved'
      RETURNING s.payload;

    UPDATE orders SET status = 'delivered', delivered_at = now() WHERE id = p_order;
  ELSE
    UPDATE stock_items
       SET status = 'available', order_id = NULL
     WHERE order_id = p_order AND status = 'reserved';

    UPDATE orders SET status = 'cancelled' WHERE id = p_order;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_payment(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_payment(uuid, boolean) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS referral_earnings_order_id_key
  ON public.referral_earnings (order_id) WHERE order_id IS NOT NULL;