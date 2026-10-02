-- Meu Controle Financeiro V2.9 — privacidade e governança de dados
CREATE TABLE IF NOT EXISTS consentimentos_privacidade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  versao_politica VARCHAR(30) NOT NULL,
  tipo VARCHAR(40) NOT NULL CHECK (tipo IN ('politica_privacidade','termos_uso')),
  aceito BOOLEAN NOT NULL,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip INET,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_consentimentos_usuario ON consentimentos_privacidade(usuario_id, aceito_em DESC);

CREATE TABLE IF NOT EXISTS solicitacoes_privacidade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('acesso','correcao','portabilidade','eliminacao','outro')),
  descricao TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','concluida','cancelada')),
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluida_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_privacidade_usuario ON solicitacoes_privacidade(usuario_id, criada_em DESC);

ALTER TABLE consentimentos_privacidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimentos_privacidade FORCE ROW LEVEL SECURITY;
ALTER TABLE solicitacoes_privacidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitacoes_privacidade FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consentimentos_privacidade_isolation ON consentimentos_privacidade;
CREATE POLICY consentimentos_privacidade_isolation ON consentimentos_privacidade
  USING (usuario_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (usuario_id = current_setting('app.user_id', true)::uuid);

DROP POLICY IF EXISTS solicitacoes_privacidade_isolation ON solicitacoes_privacidade;
CREATE POLICY solicitacoes_privacidade_isolation ON solicitacoes_privacidade
  USING (usuario_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (usuario_id = current_setting('app.user_id', true)::uuid);
