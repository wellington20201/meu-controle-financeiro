-- V5.1 — garante uma conta ativa inicial para usuários existentes.
-- Seguro para executar mais de uma vez: somente cria a conta quando o usuário não possui nenhuma conta ativa.
INSERT INTO contas (usuario_id, nome, tipo, saldo_inicial, ativa)
SELECT u.id, 'Conta principal', 'corrente', 0, TRUE
FROM usuarios u
WHERE u.ativo = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM contas c
    WHERE c.usuario_id = u.id
      AND c.ativa = TRUE
  );
