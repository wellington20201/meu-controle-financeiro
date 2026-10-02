# V3.9 — Dívidas e compromissos

A V3.9 adiciona uma área para acompanhar empréstimos, financiamentos e parcelamentos sem misturá-los automaticamente com lançamentos pagos.

## Princípios
- Cadastro e atualização exigem confirmação explícita.
- O módulo é informativo e não movimenta dinheiro.
- Saldo devedor, parcela e quantidade de parcelas restantes são dados separados.
- Dados são isolados por usuário via PostgreSQL RLS.
- A quitação de uma dívida não é presumida pelo sistema.
