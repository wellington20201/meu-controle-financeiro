-- V3.7 — Carteira de Investimentos e Patrimônio
-- A tabela investimentos já existe na base V1; esta migração adiciona apenas índices úteis.
CREATE INDEX IF NOT EXISTS idx_investimentos_usuario_ativo ON investimentos(usuario_id, ativo);
CREATE INDEX IF NOT EXISTS idx_investimentos_conta ON investimentos(conta_id);
