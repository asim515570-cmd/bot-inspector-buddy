-- Fixes two classes of money-handling races that existed in application code:
--   1. Balance credits/debits were done as a JS read-then-write (SELECT balance,
--      compute next value, UPDATE), which loses updates under concurrent
--      requests (two simultaneous checkouts/admin adjustments could both read
--      the same starting balance).
--   2. Approving/rejecting a manual payment updated the order's status without
--      first checking, under a row lock, that it was still 'pending' — two
--      admins deciding the same order at once could both act on it.
--
-- Both new functions follow the same pattern already used by
-- decide_withdrawal (lock the row, verify state, mutate, done in one
-- statement) instead of separate SELECT + UPDATE calls from application code.

-- Atomic balance adjustment used for: paying from balance at checkout,
-- admin /credit and /debit, dashboard balance adjustments, and refunds.
CREATE OR REPLACE FUNCTION public.adjust_bot_user_balance(
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

-- Approve/reject a manual payment atomically: locks the order, checks it is
-- still 'pending', then marks it paid+delivered (returning the delivered
-- stock payloads) or cancels it and releases the reserved stock.
CREATE OR REPLACE FUNCTION public.decide_payment(p_order uuid, p_approve boolean)
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

-- Defense in depth: pay_referral_commission already guards against paying an
-- order's commission twice with an EXISTS check, but that check plus a later
-- INSERT is itself two statements. A unique index makes double-payment
-- impossible at the DB level even under a race, because the second INSERT
-- fails and rolls back that call's balance credit.
CREATE UNIQUE INDEX IF NOT EXISTS referral_earnings_order_id_key
  ON public.referral_earnings (order_id) WHERE order_id IS NOT NULL;
