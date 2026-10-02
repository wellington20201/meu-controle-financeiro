# Segurança V2.3 — Fundação

## Objetivo
Reduzir drasticamente a superfície de ataque e impedir que uma falha em uma camada entregue acesso amplo aos dados financeiros.

## Proteções implementadas
- **Sessão segura:** token opaco aleatório, armazenado apenas como hash no PostgreSQL; cookie `HttpOnly` e `Secure` em produção.
- **CSRF:** token separado por sessão exigido em POST/PATCH/DELETE.
- **Rate limiting:** limite global e limites específicos para login/cadastro.
- **Headers:** Helmet, CSP, proteção contra framing e outras políticas HTTP.
- **CORS:** origem configurável e credenciais explícitas.
- **Senhas:** Argon2id com parâmetros de memória/tempo/paralelismo e mínimo de 12 caracteres.
- **Sessões:** expiração, logout real, revogação individual e revogação das demais sessões.
- **Auditoria:** eventos de login, criação de conta, logout, alteração de mascote e operações financeiras críticas.
- **Isolamento:** consultas de criação validam que contas, categorias, cartões e pagamentos pertencem ao usuário autenticado.
- **Confirmação financeira:** backend rejeita operações financeiras críticas sem confirmação explícita.
- **Anexos:** tipos permitidos e limite de 10 MB no endpoint de metadados.

## Próxima camada antes do lançamento público
1. Recuperação de senha por e-mail com token de uso único e expiração.
2. Verificação de e-mail.
3. MFA/2FA opcional.
4. Storage privado de anexos + antivírus/quarentena.
5. Backup criptografado e teste de restauração.
6. PostgreSQL RLS como defesa adicional, após padronizar o contexto de usuário nas conexões.
7. SAST, análise de dependências e testes automatizados de autorização.
8. Testes específicos de SQL injection, XSS, CSRF, IDOR, brute force, upload malicioso e sequestro de sessão.
9. Pentest antes da abertura pública.
10. Monitoramento/alertas de eventos anômalos.

## Regra de produção
Nenhum segredo deve ficar no código-fonte ou no frontend. HTTPS deve ser obrigatório. O banco deve aceitar conexões somente da infraestrutura autorizada e backups devem ser criptografados.
