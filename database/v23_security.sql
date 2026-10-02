BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sessoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token_hash CHAR(64) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ NOT NULL,
  revogado_em TIMESTAMPTZ,
  user_agent TEXT,
  ip INET
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id,revogado_em,expira_em);
CREATE INDEX IF NOT EXISTS idx_sessoes_expiracao ON sessoes(expira_em) WHERE revogado_em IS NULL;

CREATE TABLE IF NOT EXISTS auditoria_seguranca (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  evento VARCHAR(80) NOT NULL,
  sucesso BOOLEAN NOT NULL DEFAULT TRUE,
  ip INET,
  user_agent TEXT,
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_data ON auditoria_seguranca(usuario_id,criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_evento_data ON auditoria_seguranca(evento,criado_em DESC);

COMMIT;
