# Meu Controle Financeiro — Segurança V2.4

A V2.4 amplia a fundação de segurança com uma segunda camada de autenticação e controles de conta.

## O que entrou

- MFA/TOTP com segredo armazenado cifrado no banco (AES-256-GCM).
- Desafio MFA separado para login, com expiração de 5 minutos e limite de tentativas.
- Alteração de senha com reautenticação; quando MFA está ativo, exige código TOTP.
- Recuperação de senha com token de uso único e expiração configurável.
- Webhook opcional para serviço de e-mail transacional.
- Em desenvolvimento, o endpoint de recuperação pode devolver o token para testes; isso não ocorre em produção.
- Gerenciamento de sessões: listar, encerrar sessão individual e encerrar outras sessões.
- Exportação dos dados da conta em JSON.
- Exclusão permanente da conta com confirmação textual, senha e MFA quando habilitado.
- Central de auditoria com eventos de segurança recentes.

## Variáveis novas

```env
MFA_ENCRYPTION_KEY=64_caracteres_hexadecimais
PASSWORD_RESET_MINUTES=30
FRONTEND_URL=https://seu-dominio
EMAIL_WEBHOOK_URL=https://seu-provedor/email
```

`MFA_ENCRYPTION_KEY` deve ser um segredo forte, fora do código-fonte. Exemplo de geração:

```bash
openssl rand -hex 32
```

O webhook de e-mail deve aceitar JSON com `to`, `type`, `link` e `expires_minutes`.

## Migração

Depois do banco V1 + V2 + V2.3, execute `database/v24_security_advanced.sql`.

## Checklist antes de produção

- HTTPS obrigatório.
- `COOKIE_SECURE=true`.
- `MFA_ENCRYPTION_KEY` real e secreto.
- `CORS_ORIGIN` restrito ao domínio oficial.
- `TRUST_PROXY` configurado corretamente se houver proxy reverso.
- Serviço de e-mail transacional configurado e testado.
- Backups criptografados e teste de restauração realizado.
- Pentest/DAST e testes de autorização antes da abertura pública.
