# Inteligência V3.2 — Cartões e parcelamentos

## Objetivo
Tornar compras de cartão previsíveis e transparentes sem registrar qualquer compromisso antes da confirmação explícita do usuário.

## Fluxo
1. Usuário informa cartão, descrição, valor, parcelas e data.
2. Endpoint `/api/cartoes/compras/preview` calcula limite restante e todas as parcelas sem gravar dados.
3. Usuário revisa o impacto.
4. Só após confirmação explícita `/api/cartoes/compras` grava compra e parcelas em uma transação.
5. `/api/cartoes/:id/fatura?mes=YYYY-MM` permite consultar a fatura prevista por competência.

## Regras
- Máximo de 60 parcelas.
- Compra que excede o limite disponível é recusada.
- A última parcela absorve eventual diferença de arredondamento.
- Transferências continuam fora das receitas/despesas econômicas.
- Prévia nunca cria compromisso.
