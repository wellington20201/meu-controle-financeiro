# Meu Controle Financeiro — Backend V2.3

Base de segurança antes da publicação.

## Principais mudanças
- Sessão por cookie `HttpOnly` em vez de JWT no `localStorage`.
- Cookie `Secure` em produção e `SameSite` configurável.
- Token CSRF por sessão para operações que alteram dados.
- Rate limiting global + limite mais rígido em login/cadastro.
- Headers de segurança via Helmet/CSP.
- CORS com allowlist e credenciais.
- Sessões persistidas no PostgreSQL com expiração e revogação.
- Tela/API de sessões ativas e revogação de outras sessões.
- Logout revoga a sessão no banco.
- Argon2id para senhas com parâmetros fortes e senha mínima de 12 caracteres.
- Auditoria de eventos de segurança.
- Validação de propriedade de contas/categorias antes de criar lançamentos.
- Validação de propriedade em recorrências, transferências, cartões e anexos.
- Anexos limitados a PDF/JPEG/PNG/WebP e 10 MB no endpoint de metadados.
- Confirmação explícita exigida pelo backend para lançamentos, recorrências, compras de cartão, aportes e pagamentos recorrentes.

## Banco
Executar na ordem:
1. `../database/meu_controle_financeiro_banco_v1.sql`
2. `../database/v22.sql`
3. `../database/v23_security.sql`

## Ambiente
Copie `.env.example` para `.env` e preencha os segredos reais. Em produção use HTTPS, `COOKIE_SECURE=true`, um domínio/allowlist de CORS restrito e um banco que não seja exposto diretamente à internet.


## V2.7
- PostgreSQL RLS com contexto transacional `app.user_id`.
- Auditoria estrutural: `npm run security:audit`.
- Smoke test RLS: `tests/rls-smoke.sql`.
