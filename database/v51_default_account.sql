-- V5.1 — garante uma conta ativa inicial para usuários existentes.
-- A migração roda fora do contexto do usuário; a função SECURITY DEFINER
-- permite executar a inicialização sem depender do contexto RLS da sessão.
CREATE OR REPLACE FUNCTION public.mcf_seed_default_accounts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO contas (usuario_id, nome, tipo, saldo_inicial, ativa)
  SELECT u.id, 'Conta principal', 'corrente', 0, TRUE
  FROM usuarios u
  WHERE u.ativo = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM contas c
      WHERE c.usuario_id = u.id
        AND c.ativa = TRUE
    );
END;
$$;

SELECT public.mcf_seed_default_accounts();
DROP FUNCTION public.mcf_seed_default_accounts();
