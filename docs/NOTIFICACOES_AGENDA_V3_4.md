# V3.4 — Notificações e calendário financeiro

## Objetivo
Dar ao usuário uma visão temporal dos compromissos e alertas informativos sem criar qualquer compromisso financeiro automaticamente.

## Recursos
- `/api/agenda?inicio=YYYY-MM-DD&fim=YYYY-MM-DD`: contas recorrentes, vencimentos de cartão e metas com prazo.
- `/api/notificacoes`: alertas de contas vencidas ou próximas do vencimento.
- `/api/notificacoes/preferencias`: preferências de tipos de alerta e antecedência.

## Regra de segurança
Notificações são somente informativas. Nenhum endpoint de notificação cria lançamento, pagamento, compra ou recorrência.

## Próxima evolução
Push Web real poderá ser conectado posteriormente com Service Worker + VAPID, sempre com opt-in explícito do usuário.
