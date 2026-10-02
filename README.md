# Meu Controle Financeiro — V5.0

Versão consolidada para a primeira etapa realmente utilizável do produto.

## O que a V5.0 consolida
- Cadastro e login com sessão segura, CSRF, rate limiting e MFA opcional.
- Escolha e troca dos cinco mascotes: Bento, Nico, Luna, Tito e Pip.
- Dashboard, lançamentos, contas, recorrências, cartões, investimentos, metas, agenda, relatórios, Minha Vida Financeira, dívidas, documentos e assistente.
- Histórico persistente do assistente por usuário.
- PWA responsiva com navegação móvel, instalação e modo offline somente para consulta.
- Segurança de dados com isolamento por usuário/RLS, trilha de auditoria e proteção de anexos.
- Privacidade/LGPD com consentimento versionado, exportação e solicitação de direitos.
- Inteligência financeira baseada exclusivamente nos registros cadastrados.

## Escopo do produto
O Meu Controle Financeiro é uma ferramenta de **controle financeiro pessoal**. Ele não é um banco e não executa operações financeiras.

Não há:
- integração com contas bancárias;
- Open Finance;
- acesso a saldos reais;
- PIX, TED ou transferências reais;
- pagamento de contas;
- ordens de investimento;
- contratação de crédito;
- movimentação automática de dinheiro.

Quando o usuário marca algo como pago, o sistema apenas registra que o pagamento já foi realizado pelo usuário.

## Fluxo principal validado estruturalmente
**Cadastro → Login → Escolha do mascote → Dashboard → Novo lançamento → Histórico → Assistente**.

Toda ação que possa representar um compromisso financeiro exige confirmação explícita antes de registrar o efeito correspondente.

## Implantação
O projeto está preparado para receber configuração de ambiente, PostgreSQL e hospedagem. A publicação pública ainda depende da infraestrutura de deploy escolhida.
