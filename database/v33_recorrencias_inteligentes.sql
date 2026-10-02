-- V3.3 - Recorrências e contas inteligentes
-- Não cria lançamentos financeiros; cria apenas previsões de pagamentos.

CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_recorrentes_data
  ON pagamentos_recorrentes(recorrencia_id, data_prevista);

CREATE INDEX IF NOT EXISTS idx_pagamentos_recorrentes_status_data
  ON pagamentos_recorrentes(status, data_prevista);

CREATE INDEX IF NOT EXISTS idx_pagamentos_recorrentes_recorrencia_data
  ON pagamentos_recorrentes(recorrencia_id, data_prevista);
