# V3.7 — Investimentos e Patrimônio

A V3.7 adiciona uma carteira de investimentos para acompanhamento patrimonial.

## Funcionalidades
- Cadastro de posições por tipo e instituição.
- Valor investido e valor atual.
- Resultado nominal da posição.
- Vínculo opcional com uma conta apenas para organização.
- Atualização manual do valor atual com confirmação explícita.
- Resumo consolidado da carteira.
- RLS existente continua protegendo `investimentos` por usuário.

## Regra financeira
O módulo é de acompanhamento. Cadastrar ou atualizar uma posição não movimenta dinheiro, não cria lançamento e não executa aplicação/resgate.

## Limitação consciente
Rentabilidade, imposto, taxas e marcação a mercado não são calculados automaticamente nesta versão. O valor atual é informado pelo usuário.
