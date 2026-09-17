ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_note text;

ALTER TABLE public.products
  ADD CONSTRAINT products_sale_price_positive CHECK (sale_price IS NULL OR sale_price >= 0);

CREATE INDEX IF NOT EXISTS products_category_idx ON public.products (category, sort_order);