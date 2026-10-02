# Meu Controle Financeiro — V5.2 — Publicação

A V5.2 prepara uma implantação de aplicação única: o mesmo serviço entrega o PWA e a API, enquanto o Render Postgres fornece o banco.

## Publicação recomendada

1. Crie um repositório Git com esta pasta como raiz.
2. No Render, crie um Blueprint a partir do `render.yaml`.
3. O Blueprint cria o Web Service e o PostgreSQL e liga `DATABASE_URL` automaticamente.
4. O serviço executa as migrações antes do deploy (`preDeployCommand`).
5. `MFA_ENCRYPTION_KEY` é gerada pelo provedor; não coloque segredos no repositório.
6. O volume privado `/var/data/private-uploads` mantém anexos fora do diretório público.
7. Depois do primeiro deploy, teste `/health`, cadastro, login, MFA, lançamento, histórico e assistente.
8. Só depois associe um domínio próprio.

## Importante

- O sistema continua sendo apenas controle financeiro.
- Não há integração bancária, Open Finance, PIX, TED, pagamentos ou movimentação automática.
- "Marcar como pago" apenas registra que o usuário já realizou o pagamento.
- Antes de uso público, configure backups e revise a política de privacidade com orientação jurídica adequada.
