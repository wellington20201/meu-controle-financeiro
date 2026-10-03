-- V50: compatibilidade entre consultas da aplicação e o schema consolidado.
-- Mantém aliases derivados usados por relatórios/inteligência sem alterar o significado dos dados.

ALTER TABLE memoria_financeira
  ADD COLUMN IF NOT EXISTS ocorrencias INTEGER GENERATED ALWAYS AS (quantidade_ocorrencias) STORED;

ALTER TABLE cartoes
  ADD COLUMN IF NOT EXISTS comprometido NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disponivel NUMERIC(14,2);

CREATE OR REPLACE FUNCTION atualizar_comprometimento_cartao(p_cartao_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE cartoes c
  SET comprometido = COALESCE((
        SELECT SUM(p.valor)
        FROM compras_cartao cc
        JOIN parcelas_cartao p ON p.compra_id = cc.id
        WHERE cc.cartao_id = c.id
          AND p.status = 'aberta'
      ),0),
      disponivel = CASE
        WHEN c.limite IS NULL THEN NULL
        ELSE c.limite - COALESCE((
          SELECT SUM(p.valor)
          FROM compras_cartao cc
          JOIN parcelas_cartao p ON p.compra_id = cc.id
          WHERE cc.cartao_id = c.id
            AND p.status = 'aberta'
        ),0)
      END
  WHERE c.id = p_cartao_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_recalcular_comprometimento_parcela()
RETURNS TRIGGER AS $$
DECLARE
  old_card UUID;
  new_card UUID;
BEGIN
  SELECT cc.cartao_id INTO old_card
  FROM compras_cartao cc
  WHERE cc.id = COALESCE(OLD.compra_id, NEW.compra_id);

  IF TG_OP <> 'DELETE' THEN
    SELECT cc.cartao_id INTO new_card
    FROM compras_cartao cc
    WHERE cc.id = NEW.compra_id;
  END IF;

  IF old_card IS NOT NULL THEN PERFORM atualizar_comprometimento_cartao(old_card); END IF;
  IF new_card IS NOT NULL AND new_card IS DISTINCT FROM old_card THEN PERFORM atualizar_comprometimento_cartao(new_card); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_parcelas_recalcular_cartao ON parcelas_cartao;
CREATE TRIGGER trg_parcelas_recalcular_cartao
AFTER INSERT OR UPDATE OR DELETE ON parcelas_cartao
FOR EACH ROW EXECUTE FUNCTION trg_recalcular_comprometimento_parcela();

CREATE OR REPLACE FUNCTION trg_recalcular_comprometimento_compra()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM atualizar_comprometimento_cartao(NEW.cartao_id); END IF;
  IF TG_OP <> 'INSERT' AND OLD.cartao_id IS DISTINCT FROM NEW.cartao_id THEN PERFORM atualizar_comprometimento_cartao(OLD.cartao_id); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compras_recalcular_cartao ON compras_cartao;
CREATE TRIGGER trg_compras_recalcular_cartao
AFTER INSERT OR UPDATE OR DELETE ON compras_cartao
FOR EACH ROW EXECUTE FUNCTION trg_recalcular_comprometimento_compra();

UPDATE cartoes c
SET comprometido = COALESCE((
      SELECT SUM(p.valor)
      FROM compras_cartao cc
      JOIN parcelas_cartao p ON p.compra_id = cc.id
      WHERE cc.cartao_id = c.id AND p.status = 'aberta'
    ),0),
    disponivel = CASE
      WHEN c.limite IS NULL THEN NULL
      ELSE c.limite - COALESCE((
        SELECT SUM(p.valor)
        FROM compras_cartao cc
        JOIN parcelas_cartao p ON p.compra_id = cc.id
        WHERE cc.cartao_id = c.id AND p.status = 'aberta'
      ),0)
    END;
