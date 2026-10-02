# Assistente V4.9 — Histórico persistente

A V4.9 mantém o assistente estritamente informativo e adiciona histórico persistente das consultas.

## Objetivo
Permitir que o usuário consulte novamente perguntas e respostas anteriores sem depender da sessão do navegador.

## Limites
- somente dados do próprio usuário;
- somente consulta, cálculo e explicação;
- não conecta bancos;
- não usa Open Finance;
- não efetua pagamentos ou transferências;
- não movimenta investimentos;
- nenhum histórico autoriza ação financeira.

## Segurança
O histórico possui RLS por `usuario_id`, índice por usuário/data e exclusão em cascata quando a conta é eliminada.
