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
  SELECT CASE
           WHEN sale_price IS NOT NULL AND sale_price > 0 AND sale_price < price THEN sale_price
           ELSE price
         END
    INTO v_price
  FROM products WHERE id = p_product AND active = true;

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