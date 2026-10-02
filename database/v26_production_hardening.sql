BEGIN;

-- V2.6 — preparação de isolamento em profundidade.
-- IMPORTANTE: as policies só devem ser habilitadas depois que o backend estiver
-- executando cada operação em transação com SET LOCAL app.user_id = '<uuid>'.
-- Não habilitar estas policies prematuramente em um backend que usa pool.query()
-- sem contexto transacional por requisição.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario_ativo ON sessoes(usuario_id, revogado_em, expira_em);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_data ON auditoria_seguranca(usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_seguranca_hash ON tokens_seguranca(token_hash);

COMMIT;
