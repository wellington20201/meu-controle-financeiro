# V3.3 — Recorrências e Contas Inteligentes

## Objetivo
Tornar contas recorrentes previsíveis sem transformar previsões em movimentações financeiras automaticamente.

## Comportamento
- Previsões são criadas para até 90 dias.
- Previsão não altera saldo nem histórico de lançamentos.
- Valor fixo é preenchido automaticamente; valor variável permanece sem valor previsto quando não há base confiável.
- Previsões vencidas passam para `atrasado`.
- Ao confirmar um pagamento, o lançamento real é criado somente após confirmação explícita.
- Após confirmação, a próxima ocorrência é preparada como previsão.
- O endpoint `/api/recorrencias/resumo` apresenta próximos compromissos e histórico real (média, mínimo, máximo e variação acumulada).

## Regra de segurança
A inteligência pode prever e comparar, mas nunca cria um lançamento financeiro sem confirmação explícita do usuário.
