# Meu Controle Financeiro — Segurança V2.6

## Objetivo
Preparar a aplicação para produção com defesa em profundidade: conexão PostgreSQL protegida, pool controlado, logs sem segredos, limites de requisição e rotina de backup/restore criptografada.

## PostgreSQL
Em produção, usar `DB_SSL=true` e validação do certificado (`DB_SSL_REJECT_UNAUTHORIZED=true`). Nunca colocar credenciais do banco no código ou no frontend.

## RLS
A migração `database/v26_production_hardening.sql` prepara a função de contexto e índices, mas **não habilita RLS automaticamente**. O backend atual usa autorização explícita por `usuario_id`; habilitar RLS exige primeiro migrar as operações para transações com `SET LOCAL app.user_id`, evitando contexto vazado entre conexões do pool.

## Backups
`ops/backup-postgres.sh` gera dump comprimido e criptografado com AES-256-CBC + PBKDF2. A senha deve ficar fora do repositório, idealmente em secret manager. O arquivo de senha não deve ser enviado ao Git.

A restauração deve ser testada periodicamente em ambiente separado. Backup que nunca foi restaurado é apenas uma esperança.

## Logs
O Fastify mascara cookies, tokens, senhas e segredos conhecidos. Logs devem continuar sem dados financeiros desnecessários e nunca registrar credenciais.

## Antes do go-live
- HTTPS obrigatório + HSTS.
- `DB_SSL=true`.
- Secrets em secret manager.
- CORS somente com domínios conhecidos.
- Backups automáticos e teste de restauração.
- Monitoramento e alertas.
- Pentest/DAST e revisão de dependências.
- Habilitar RLS somente após a migração transacional do contexto do usuário.
