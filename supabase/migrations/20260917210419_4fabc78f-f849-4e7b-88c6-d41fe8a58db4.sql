ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz;

CREATE OR REPLACE FUNCTION public.place_order(p_bot_user uuid, p_product uuid, p_qty integer DEFAULT 1)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_price numeric(12,2);
  v_order uuid;
  v_ids uuid[];
BEGIN
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 100 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  SELECT CASE
           WHEN sale_price IS NOT NULL AND sale_price > 0 AND sale_price < price
                AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price
           ELSE price
         END
    INTO v_price
  FROM products WHERE id = p_product AND active = true;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'product_unavailable';
  END IF;

  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM stock_items
     WHERE product_id = p_product AND status = 'available'
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_qty
  ) s;

  IF v_ids IS NULL OR array_length(v_ids, 1) < p_qty THEN
    RAISE EXCEPTION 'out_of_stock';
  END IF;

  INSERT INTO orders (bot_user_id, product_id, status, quantity, unit_price, total_price)
  VALUES (p_bot_user, p_product, 'pending', p_qty, v_price, v_price * p_qty)
  RETURNING id INTO v_order;

  UPDATE stock_items SET status = 'reserved', order_id = v_order WHERE id = ANY(v_ids);

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.place_order(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, uuid, integer) TO service_role;