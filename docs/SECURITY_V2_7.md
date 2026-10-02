# Meu Controle Financeiro — V2.7
## Isolamento definitivo e testes de segurança

A V2.7 adiciona PostgreSQL Row-Level Security (RLS) como segunda barreira de isolamento, além da autorização explícita já existente no backend.

### Como funciona
- Cada requisição autenticada recebe um `app.user_id` no contexto transacional.
- Consultas autenticadas passam por transações curtas com `SET LOCAL` via `set_config(..., true)`.
- Tabelas financeiras usam `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- As policies permitem somente linhas pertencentes ao usuário atual.
- Categorias de sistema (`usuario_id IS NULL`) continuam disponíveis para leitura.
- Pagamentos recorrentes e parcelas de cartão são protegidos por relacionamento com a entidade do usuário.

### Por que existem duas camadas
1. A API continua exigindo `usuario_id`/propriedade em suas consultas.
2. O PostgreSQL bloqueia uma eventual consulta mal formada que tente atravessar o limite de usuário.

### Testes
- `backend/scripts_security_audit.mjs`: auditoria estrutural local.
- `backend/tests/rls-smoke.sql`: smoke test para executar em staging/banco de teste.

### Antes de produção
- Aplicar `database/v27_rls_isolation.sql` em staging.
- Rodar o smoke test com uma conta de banco sem privilégios administrativos desnecessários.
- Executar os testes automatizados da API com dois usuários reais de teste.
- Confirmar que backups/restores mantêm as policies.
- Nunca executar a aplicação com superuser PostgreSQL, porque superusers podem ignorar RLS.
