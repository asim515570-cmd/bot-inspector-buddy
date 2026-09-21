CREATE OR REPLACE FUNCTION public.adjust_bot_user_balance(
  p_bot_user uuid,
  p_delta numeric,
  p_reason text DEFAULT 'Adjustment',
  p_order_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new numeric;
BEGIN
  SELECT COALESCE(balance, 0) + p_delta INTO v_new
  FROM bot_users WHERE id = p_bot_user FOR UPDATE;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'no_such_user';
  END IF;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  UPDATE bot_users SET balance = v_new WHERE id = p_bot_user;

  INSERT INTO wallet_transactions (bot_user_id, amount, balance_after, reason, order_id)
  VALUES (p_bot_user, p_delta, v_new, COALESCE(p_reason, 'Adjustment'), p_order_id);

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_bot_user_balance(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_bot_user_balance(uuid, numeric, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.decide_payment(p_order uuid, p_approve boolean)
RETURNS TABLE(payload text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM orders WHERE id = p_order FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'no_such_order';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'already_decided';
  END IF;

  IF p_approve THEN
    RETURN QUERY
    UPDATE stock_items s
       SET status = 'delivered', delivered_at = now()
     WHERE s.order_id = p_order AND s.status = 'reserved'
    RETURNING s.payload;

    UPDATE orders
       SET status = 'delivered', delivered_at = now()
     WHERE id = p_order;
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