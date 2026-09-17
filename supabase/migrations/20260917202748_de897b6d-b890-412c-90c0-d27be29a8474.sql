-- Orders: full purchase record
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  ADD COLUMN IF NOT EXISTS unit_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  ADD COLUMN IF NOT EXISTS total_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','paid','delivered','cancelled','refunded'));

DROP TRIGGER IF EXISTS orders_touch ON public.orders;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(status);
CREATE INDEX IF NOT EXISTS orders_bot_user_idx ON public.orders(bot_user_id);
CREATE INDEX IF NOT EXISTS stock_items_product_status_idx ON public.stock_items(product_id, status);

-- Customers: wallet + moderation
ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS balance numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- Wallet ledger
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_user_id uuid NOT NULL REFERENCES public.bot_users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  reason text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to wallet transactions"
  ON public.wallet_transactions FOR SELECT TO anon, authenticated USING (false);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON public.wallet_transactions(bot_user_id);

-- Shop settings
CREATE TABLE IF NOT EXISTS public.shop_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shop_settings TO service_role;
ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to shop settings"
  ON public.shop_settings FOR SELECT TO anon, authenticated USING (false);
DROP TRIGGER IF EXISTS shop_settings_touch ON public.shop_settings;
CREATE TRIGGER shop_settings_touch BEFORE UPDATE ON public.shop_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.shop_settings(key, value) VALUES
  ('welcome_message', 'Welcome to the shop! 🛍'),
  ('support_contact', ''),
  ('payment_instructions', 'Send payment and reply with your transaction reference. An admin will confirm it shortly.')
ON CONFLICT (key) DO NOTHING;

-- Atomic checkout: reserve exactly one stock item and open an order
CREATE OR REPLACE FUNCTION public.place_order(p_bot_user uuid, p_product uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_id uuid;
  v_price numeric(12,2);
  v_order uuid;
BEGIN
  SELECT price INTO v_price FROM products WHERE id = p_product AND active = true;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'product_unavailable';
  END IF;

  SELECT id INTO v_stock_id
  FROM stock_items
  WHERE product_id = p_product AND status = 'available'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_stock_id IS NULL THEN
    RAISE EXCEPTION 'out_of_stock';
  END IF;

  INSERT INTO orders (bot_user_id, product_id, status, quantity, unit_price, total_price)
  VALUES (p_bot_user, p_product, 'pending', 1, v_price, v_price)
  RETURNING id INTO v_order;

  UPDATE stock_items SET status = 'reserved', order_id = v_order WHERE id = v_stock_id;

  RETURN v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.place_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, uuid) TO service_role;

-- Deliver: hand over the reserved item and close the order
CREATE OR REPLACE FUNCTION public.deliver_order(p_order uuid)
RETURNS TABLE (payload text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE stock_items s
     SET status = 'delivered', delivered_at = now()
   WHERE s.order_id = p_order AND s.status = 'reserved'
  RETURNING s.payload;

  UPDATE orders
     SET status = 'delivered', delivered_at = now()
   WHERE id = p_order;
END;
$$;
REVOKE ALL ON FUNCTION public.deliver_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_order(uuid) TO service_role;

-- Release: cancel an order and return its item to stock
CREATE OR REPLACE FUNCTION public.release_order(p_order uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE stock_items
     SET status = 'available', order_id = NULL
   WHERE order_id = p_order AND status = 'reserved';
  UPDATE orders SET status = p_status WHERE id = p_order;
END;
$$;
REVOKE ALL ON FUNCTION public.release_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_order(uuid, text) TO service_role;