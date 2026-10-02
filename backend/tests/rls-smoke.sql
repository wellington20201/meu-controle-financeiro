-- V2.7 RLS smoke test template.
-- Execute after applying v27_rls_isolation.sql.
-- The test is intentionally SQL-only so it can run in staging without exposing data.

BEGIN;

DO $$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  c1 uuid;
  c2 uuid;
  visible_count integer;
BEGIN
  INSERT INTO usuarios(id,email,senha_hash,nome) VALUES
    (u1, 'rls-smoke-u1-' || u1 || '@invalid.local', 'smoke', 'RLS Smoke 1'),
    (u2, 'rls-smoke-u2-' || u2 || '@invalid.local', 'smoke', 'RLS Smoke 2');

  PERFORM set_config('app.user_id', u1::text, true);
  INSERT INTO contas(usuario_id,nome,tipo,saldo_inicial) VALUES (u1,'RLS Conta 1','corrente',10) RETURNING id INTO c1;
  PERFORM set_config('app.user_id', u2::text, true);
  INSERT INTO contas(usuario_id,nome,tipo,saldo_inicial) VALUES (u2,'RLS Conta 2','corrente',20) RETURNING id INTO c2;

  PERFORM set_config('app.user_id', u1::text, true);
  SELECT count(*) INTO visible_count FROM contas;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'RLS leak: user 1 sees % accounts', visible_count; END IF;
  IF EXISTS (SELECT 1 FROM contas WHERE id = c2) THEN RAISE EXCEPTION 'RLS leak: user 1 sees user 2 account'; END IF;

  PERFORM set_config('app.user_id', u2::text, true);
  SELECT count(*) INTO visible_count FROM contas;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'RLS leak: user 2 sees % accounts', visible_count; END IF;
  IF EXISTS (SELECT 1 FROM contas WHERE id = c1) THEN RAISE EXCEPTION 'RLS leak: user 2 sees user 1 account'; END IF;

  RAISE NOTICE 'RLS smoke test PASS';
END $$;

ROLLBACK;
