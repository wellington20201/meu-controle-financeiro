BEGIN;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS mfa_confirmado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS desafios_mfa_login (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_desafios_mfa_expiracao ON desafios_mfa_login(expira_em);
CREATE INDEX IF NOT EXISTS idx_desafios_mfa_usuario ON desafios_mfa_login(usuario_id);

CREATE TABLE IF NOT EXISTS tokens_seguranca (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('recuperacao_senha','verificacao_email')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tokens_seguranca_usuario ON tokens_seguranca(usuario_id,tipo,expira_em);
CREATE INDEX IF NOT EXISTS idx_tokens_seguranca_expiracao ON tokens_seguranca(expira_em) WHERE usado_em IS NULL;

COMMIT;
