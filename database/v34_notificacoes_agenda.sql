-- Meu Controle Financeiro V3.4
CREATE TABLE IF NOT EXISTS preferencias_notificacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  contas_vencimento BOOLEAN NOT NULL DEFAULT TRUE,
  contas_vencidas BOOLEAN NOT NULL DEFAULT TRUE,
  faturas BOOLEAN NOT NULL DEFAULT TRUE,
  metas BOOLEAN NOT NULL DEFAULT TRUE,
  antecedencia_dias INTEGER NOT NULL DEFAULT 3 CHECK (antecedencia_dias BETWEEN 0 AND 30),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE preferencias_notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferencias_notificacao FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preferencias_notificacao_owner ON preferencias_notificacao;
CREATE POLICY preferencias_notificacao_owner ON preferencias_notificacao USING (usuario_id = current_setting('app.user_id', true)::uuid) WITH CHECK (usuario_id = current_setting('app.user_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_preferencias_notificacao_usuario ON preferencias_notificacao(usuario_id);
