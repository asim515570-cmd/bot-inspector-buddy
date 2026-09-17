-- referral + wallet fields
ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.bot_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_earned numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.bot_users
SET referral_code = 'R' || upper(substr(replace(id::text,'-',''), 1, 7))
WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bot_users_referral_code_key ON public.bot_users (referral_code);

CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := 'R' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 7));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS bot_users_referral_code ON public.bot_users;
CREATE TRIGGER bot_users_referral_code BEFORE INSERT ON public.bot_users
FOR EACH ROW EXECUTE FUNCTION public.set_referral_code();

-- referral commission ledger
CREATE TABLE IF NOT EXISTS public.referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.bot_users(id) ON DELETE CASCADE,
  source_user_id uuid NOT NULL REFERENCES public.bot_users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.referral_earnings TO service_role;
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to referral earnings" ON public.referral_earnings
  FOR SELECT TO anon, authenticated USING (false);

-- withdrawals
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_user_id uuid NOT NULL REFERENCES public.bot_users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL,
  address text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.withdrawals TO service_role;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to withdrawals" ON public.withdrawals
  FOR SELECT TO anon, authenticated USING (false);
DROP TRIGGER IF EXISTS withdrawals_touch ON public.withdrawals;
CREATE TRIGGER withdrawals_touch BEFORE UPDATE ON public.withdrawals
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- duplicate transaction id protection
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_reference_key
  ON public.orders (lower(payment_reference)) WHERE payment_reference IS NOT NULL;

-- money operations
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_bot_user uuid, p_amount numeric, p_method text, p_address text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance numeric(12,2); v_id uuid;
BEGIN
  SELECT balance INTO v_balance FROM bot_users WHERE id = p_bot_user FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF v_balance < p_amount THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  UPDATE bot_users SET balance = balance - p_amount WHERE id = p_bot_user;
  INSERT INTO withdrawals (bot_user_id, amount, method, address)
  VALUES (p_bot_user, p_amount, p_method, p_address) RETURNING id INTO v_id;
  INSERT INTO wallet_transactions (bot_user_id, amount, balance_after, reason)
  VALUES (p_bot_user, -p_amount, v_balance - p_amount, 'Withdrawal request on hold');
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.decide_withdrawal(
  p_withdrawal uuid, p_approve boolean, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; v_balance numeric(12,2);
BEGIN
  SELECT * INTO w FROM withdrawals WHERE id = p_withdrawal FOR UPDATE;
  IF w IS NULL THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'already_decided'; END IF;

  IF p_approve THEN
    UPDATE withdrawals SET status = 'approved', admin_note = p_note, decided_at = now()
    WHERE id = p_withdrawal;
  ELSE
    UPDATE bot_users SET balance = balance + w.amount WHERE id = w.bot_user_id
    RETURNING balance INTO v_balance;
    INSERT INTO wallet_transactions (bot_user_id, amount, balance_after, reason)
    VALUES (w.bot_user_id, w.amount, v_balance, 'Withdrawal rejected - amount returned');
    UPDATE withdrawals SET status = 'rejected', admin_note = p_note, decided_at = now()
    WHERE id = p_withdrawal;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.pay_referral_commission(p_order uuid, p_percent numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_ref uuid; v_amount numeric(12,2); v_balance numeric(12,2);
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order;
  IF o IS NULL THEN RETURN 0; END IF;
  SELECT referred_by INTO v_ref FROM bot_users WHERE id = o.bot_user_id;
  IF v_ref IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM referral_earnings WHERE order_id = p_order) THEN RETURN 0; END IF;

  v_amount := round(o.total_price * p_percent / 100.0, 2);
  IF v_amount <= 0 THEN RETURN 0; END IF;

  UPDATE bot_users
     SET balance = balance + v_amount, referral_earned = referral_earned + v_amount
   WHERE id = v_ref
  RETURNING balance INTO v_balance;

  INSERT INTO referral_earnings (referrer_id, source_user_id, order_id, amount)
  VALUES (v_ref, o.bot_user_id, p_order, v_amount);
  INSERT INTO wallet_transactions (bot_user_id, amount, balance_after, reason, order_id)
  VALUES (v_ref, v_amount, v_balance, 'Referral commission', p_order);
  RETURN v_amount;
END; $$;

REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_withdrawal(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay_referral_commission(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_withdrawal(uuid, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_referral_commission(uuid, numeric) TO service_role;

INSERT INTO public.shop_settings (key, value) VALUES
  ('referral_percent', '5'),
  ('min_withdrawal', '10'),
  ('withdrawal_methods', 'USDT TRC20, Binance Pay, UPI')
ON CONFLICT (key) DO NOTHING;