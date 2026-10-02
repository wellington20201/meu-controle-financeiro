# V2.8 — Matriz de testes de segurança

Executar somente em desenvolvimento/staging com dados fictícios.

| Área | Cenário | Resultado esperado |
|---|---|---|
| Auth | GET financeiro sem sessão | 401 |
| Auth | POST financeiro sem sessão | 401 |
| CSRF | POST com token ausente/inválido | 403 |
| IDOR | usuário B consulta ID de A | nenhum dado de A |
| IDOR | usuário B altera ID de A | operação não altera A |
| RLS | SELECT direto com contexto de B | somente registros de B |
| SQLi | parâmetro com payload SQL | entrada tratada como dado |
| XSS | descrição com `<script>` | não executa no frontend |
| Sessão | sessão revogada usada novamente | 401 |
| MFA | código inválido repetido | bloqueio por rate limit |
| Upload | extensão permitida com conteúdo falso | rejeitado |
| Upload | arquivo acima do limite | rejeitado |
| Recorrência | confirmação repetida | não cria lançamento duplicado |
| Cartão | compra acima do limite | rejeitada |
| Exportação | sem reautenticação exigida | rejeitada |
| Logs | senha/token/cookie em erro | não deve aparecer |
| Backup | restauração em banco vazio | banco recupera sem corrupção |
