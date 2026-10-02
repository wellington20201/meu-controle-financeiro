# Meu Controle Financeiro — Segurança V2.8

## Objetivo

A V2.8 transforma a estratégia de segurança em uma rotina de testes. A regra é: uma proteção não deve ser considerada concluída apenas porque existe no código; ela deve possuir um teste que demonstre o comportamento esperado.

## Testes incluídos

### Auditoria estática
`backend/scripts/security-static-audit.mjs`

Verifica automaticamente a presença de controles críticos e sinais de regressão, incluindo sessão por cookie, CSRF, contexto RLS, rate limiting, redaction de segredos, validação de assinatura de uploads e ausência de token Bearer hard-coded.

### Pentest automatizado da API
`backend/scripts/security-pentest.mjs`

Executa contra uma instância de desenvolvimento/staging. Sem credenciais, testa endpoints protegidos. Com duas contas de teste, verifica isolamento entre usuários, CSRF e comportamento das sessões.

> Os testes não devem ser executados contra produção sem autorização explícita e janela controlada.

## Execução

```bash
npm run security:static
npm run security:pentest
```

Para o pentest cross-user:

```text
TEST_BASE_URL=https://staging.example
TEST_USER_A_EMAIL=...
TEST_USER_A_PASSWORD=...
TEST_USER_B_EMAIL=...
TEST_USER_B_PASSWORD=...
```

## Critério de publicação

Uma release de produção deve ter:

1. auditoria estática sem falhas;
2. pentest automatizado sem falhas;
3. smoke test RLS executado em PostgreSQL real;
4. backup restaurado em ambiente separado;
5. dependências auditadas;
6. revisão manual de autenticação/autorização;
7. nenhum segredo presente no repositório;
8. HTTPS e cookies seguros habilitados.

## Limitações

Os scripts desta versão são uma camada automatizada de defesa e não substituem um pentest humano independente. O sistema não deve ser descrito como invulnerável.
