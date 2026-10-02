# Inteligência Financeira V3.1

## Lançamento inteligente
O Meu Controle agora pode consultar a memória financeira enquanto o usuário digita uma descrição de lançamento.

A API `/api/lancamentos/sugestoes` procura padrões do próprio usuário e, quando não encontra histórico, usa heurísticas simples de descrição para sugerir uma categoria.

A sugestão pode incluir:
- categoria;
- média histórica do valor;
- faixa mínima/máxima;
- frequência;
- indicação de recorrência detectada;
- número de ocorrências;
- confiança estimada.

## Regra de agência
As sugestões nunca são aplicadas automaticamente. O usuário precisa tocar em **Aplicar** e ainda confirmar o lançamento antes de salvar.

## Privacidade
As sugestões são calculadas com dados do próprio usuário e respeitam o isolamento existente por usuário/RLS. Nenhuma descrição é enviada a serviço externo.
