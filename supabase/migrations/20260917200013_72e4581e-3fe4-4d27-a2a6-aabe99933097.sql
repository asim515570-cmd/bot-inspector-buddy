CREATE TABLE public.telegram_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  update_id BIGINT,
  telegram_user_id BIGINT,
  chat_id BIGINT,
  text TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX telegram_updates_created_at_idx ON public.telegram_updates (created_at DESC);
GRANT ALL ON public.telegram_updates TO service_role;
ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;