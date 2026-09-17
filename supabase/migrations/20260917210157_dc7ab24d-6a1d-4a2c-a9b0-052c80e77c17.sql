REVOKE ALL ON FUNCTION public.place_order(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, uuid, integer) TO service_role;