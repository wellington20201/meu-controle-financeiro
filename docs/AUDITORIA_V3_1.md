# Auditoria V3.1

## Escopo
Inteligência de lançamentos: sugestões de categoria e valor durante o preenchimento de um novo lançamento.

## Resultado
8/8 verificações estruturais: PASS.

- Endpoint de sugestões presente.
- Consulta usa memória financeira do usuário.
- Consulta é filtrada por `usuario_id`.
- Aplicação é manual por botão `Aplicar`.
- Salvamento continua exigindo confirmação explícita.
- Sugestão não cria lançamento automaticamente.
- Média histórica pode preencher o valor apenas após aplicação manual.
- Heurísticas locais não dependem de serviço externo.

## Limitação
O build completo depende das dependências npm do projeto e de um ambiente PostgreSQL de staging para testes de integração. Esta auditoria não substitui esses testes.
