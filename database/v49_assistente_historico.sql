-- V4.9 — Histórico persistente do assistente financeiro
CREATE TABLE IF NOT EXISTS assistente_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  tipo VARCHAR(80) NOT NULL DEFAULT 'orientacao',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistente_historico_usuario_data ON assistente_historico(usuario_id, criado_em DESC);
ALTER TABLE assistente_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistente_historico FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistente_historico_isolamento ON assistente_historico;
CREATE POLICY assistente_historico_isolamento ON assistente_historico USING (usuario_id = current_setting('app.user_id', true)::uuid) WITH CHECK (usuario_id = current_setting('app.user_id', true)::uuid);
