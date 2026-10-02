BEGIN;
CREATE TABLE IF NOT EXISTS dividas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 nome TEXT NOT NULL,
 credor TEXT,
 tipo TEXT NOT NULL DEFAULT 'outro' CHECK (tipo IN ('emprestimo','financiamento','parcelamento','outro')),
 valor_original NUMERIC(14,2) NOT NULL CHECK (valor_original >= 0),
 saldo_devedor NUMERIC(14,2) NOT NULL CHECK (saldo_devedor >= 0),
 parcela_atual NUMERIC(14,2),
 parcelas_restantes INTEGER,
 taxa_mensal NUMERIC(10,4),
 data_inicio DATE,
 data_fim_prevista DATE,
 observacao TEXT,
 ativa BOOLEAN NOT NULL DEFAULT true,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dividas_usuario ON dividas(usuario_id);
ALTER TABLE dividas ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcf_user_isolation ON dividas;
CREATE POLICY mcf_user_isolation ON dividas USING (usuario_id=app_current_user_id()) WITH CHECK (usuario_id=app_current_user_id());
COMMIT;
