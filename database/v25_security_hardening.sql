BEGIN;

-- V2.5: endurecimento do armazenamento de anexos.
-- O caminho é sempre gerado pelo servidor; nunca confiar em caminho enviado pelo cliente.
ALTER TABLE anexos
  ADD CONSTRAINT anexos_tamanho_limite CHECK (tamanho_bytes IS NULL OR tamanho_bytes BETWEEN 1 AND 10485760);

CREATE INDEX IF NOT EXISTS idx_anexos_usuario_pagamento ON anexos(usuario_id,pagamento_id,criado_em DESC);

-- Índices adicionais para consultas de autorização e limpeza de sessão/tokens.
CREATE INDEX IF NOT EXISTS idx_lancamentos_usuario_conta ON lancamentos(usuario_id,conta_id);
CREATE INDEX IF NOT EXISTS idx_cartoes_usuario ON cartoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_metas_usuario ON metas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_recorrencias_usuario ON recorrencias(usuario_id);

-- Função opcional para verificar o contexto da aplicação quando RLS for habilitado
-- em produção. O backend V2.5 continua usando autorização explícita por usuario_id.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

COMMIT;
