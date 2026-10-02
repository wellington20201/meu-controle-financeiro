# Assistente — V4.4

A V4.4 fortalece o assistente dentro de um limite claro: **controle financeiro, não operação financeira**.

### Permitido
- consultar lançamentos, metas, investimentos, dívidas, cartões, recorrências e relatórios do próprio usuário;
- fazer cálculos;
- comparar períodos;
- simular cenários;
- explicar padrões;
- sugerir ações manuais.

### Bloqueado
- conectar banco;
- solicitar credenciais bancárias;
- executar PIX/TED/transferência;
- pagar boleto ou conta;
- alterar saldo bancário real;
- criar ordem de investimento;
- contratar crédito;
- executar qualquer operação financeira externa.

### Segurança semântica
O assistente deve responder explicitamente quando houver confusão entre **registrar** e **executar**. Exemplo: “Posso registrar que essa despesa foi paga, mas o aplicativo não realiza o pagamento.”
