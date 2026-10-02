# Auditoria V5.0 — Consolidação

## Fluxos
- [x] Cadastro e login presentes no frontend.
- [x] MFA presente no fluxo de login.
- [x] Escolha de mascote após autenticação.
- [x] Mascote persistido no usuário e disponível nas configurações.
- [x] Dashboard conectado à API.
- [x] Novo lançamento conectado à API.
- [x] Histórico de lançamentos disponível.
- [x] Assistente com histórico persistente.

## Produto
- [x] Escopo restrito a controle financeiro pessoal.
- [x] Sem banco/Open Finance/pagamentos/operações reais.
- [x] Confirmação explícita em ações financeiras sensíveis.
- [x] Offline limitado à consulta.

## Segurança
- [x] Sessão por cookie HttpOnly.
- [x] CSRF.
- [x] Rate limiting.
- [x] MFA.
- [x] RLS para isolamento de dados.
- [x] Auditoria de segurança.
- [x] Upload privado com validação.

## Correções desta versão
- [x] Corrigida referência visual do ícone do Assistente no frontend (`MessageCircle`).
- [x] A área Minha Vida Financeira passou a usar o mascote efetivamente escolhido pelo usuário, em vez de exibir um mascote fixo.
- [x] Identidade de versão atualizada para V5.0 em projeto, backend e frontend.
- [x] README consolidado e alinhado ao escopo atual do produto.

## Observação de validação
A revisão estrutural foi executada sobre o código-fonte consolidado. A instalação de dependências/build automático não pôde ser concluída neste ambiente durante a janela de execução, portanto esta auditoria não declara um build de produção executado.
