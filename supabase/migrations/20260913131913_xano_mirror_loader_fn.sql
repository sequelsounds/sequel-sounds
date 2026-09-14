CREATE OR REPLACE FUNCTION public.xano_mirror_load(p_table text, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'xano_mirror' AND table_name = p_table
  ) THEN
    RAISE EXCEPTION 'unknown mirror table: %', p_table;
  END IF;
  EXECUTE format(
    'INSERT INTO xano_mirror.%I SELECT * FROM jsonb_populate_recordset(NULL::xano_mirror.%I, $1)',
    p_table, p_table
  ) USING p_rows;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION public.xano_mirror_load(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.xano_mirror_load(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.xano_mirror_load(text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.xano_mirror_load(text, jsonb) TO service_role;
