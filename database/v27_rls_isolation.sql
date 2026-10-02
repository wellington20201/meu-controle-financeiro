BEGIN;

-- V2.7 — isolamento de dados em profundidade com PostgreSQL RLS.
-- O backend define SET LOCAL app.user_id dentro de cada transação autenticada.
-- FORCE ROW LEVEL SECURITY evita que o proprietário da tabela contorne as policies.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Tabelas diretamente pertencentes ao usuário.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contas','cartoes','recorrencias','lancamentos','compras_cartao',
    'anexos','metas','investimentos','transferencias','memoria_financeira'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS mcf_user_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY mcf_user_isolation ON %I USING (usuario_id = app_current_user_id()) WITH CHECK (usuario_id = app_current_user_id())',
      t
    );
  END LOOP;
END $$;

-- Categorias: cada usuário vê/modifica as suas; categorias do sistema (NULL) são apenas leitura.
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcf_categoria_isolation ON categorias;
CREATE POLICY mcf_categoria_isolation ON categorias
  USING (usuario_id = app_current_user_id() OR usuario_id IS NULL)
  WITH CHECK (usuario_id = app_current_user_id());

-- Pagamentos recorrentes pertencem ao dono da recorrência.
ALTER TABLE pagamentos_recorrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos_recorrentes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcf_pagamento_recorrente_isolation ON pagamentos_recorrentes;
CREATE POLICY mcf_pagamento_recorrente_isolation ON pagamentos_recorrentes
  USING (EXISTS (
    SELECT 1 FROM recorrencias r
    WHERE r.id = pagamentos_recorrentes.recorrencia_id
      AND r.usuario_id = app_current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM recorrencias r
    WHERE r.id = pagamentos_recorrentes.recorrencia_id
      AND r.usuario_id = app_current_user_id()
  ));

-- Parcelas pertencem à compra/cartão do usuário.
ALTER TABLE parcelas_cartao ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcelas_cartao FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcf_parcela_cartao_isolation ON parcelas_cartao;
CREATE POLICY mcf_parcela_cartao_isolation ON parcelas_cartao
  USING (EXISTS (
    SELECT 1 FROM compras_cartao cc
    WHERE cc.id = parcelas_cartao.compra_id
      AND cc.usuario_id = app_current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM compras_cartao cc
    WHERE cc.id = parcelas_cartao.compra_id
      AND cc.usuario_id = app_current_user_id()
  ));

CREATE INDEX IF NOT EXISTS idx_contas_usuario ON contas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_usuario ON lancamentos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_recorrencias_usuario ON recorrencias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_cartoes_usuario ON cartoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_compras_cartao_usuario ON compras_cartao(usuario_id);
CREATE INDEX IF NOT EXISTS idx_anexos_usuario ON anexos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_metas_usuario ON metas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_investimentos_usuario ON investimentos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_usuario ON transferencias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_memoria_usuario ON memoria_financeira(usuario_id);

COMMIT;
