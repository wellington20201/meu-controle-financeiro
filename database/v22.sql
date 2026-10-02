BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mascote_id VARCHAR(30) NOT NULL DEFAULT 'bento';

CREATE TABLE IF NOT EXISTS parcelas_cartao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID NOT NULL REFERENCES compras_cartao(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  total_parcelas INTEGER NOT NULL,
  valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  data_vencimento DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(compra_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_compra ON parcelas_cartao(compra_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_vencimento ON parcelas_cartao(data_vencimento, status);
CREATE INDEX IF NOT EXISTS idx_lancamentos_usuario_data ON lancamentos(usuario_id, data_movimento, status);
CREATE INDEX IF NOT EXISTS idx_compras_cartao_usuario ON compras_cartao(usuario_id, data_compra);

UPDATE usuarios SET mascote_id='bento' WHERE mascote_id IS NULL;

COMMIT;
