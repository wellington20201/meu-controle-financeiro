# Meu Controle Financeiro — Segurança V2.5

## Objetivo
Endurecer o tratamento de anexos e reduzir a superfície de ataque antes da publicação.

### Upload seguro
- Permite apenas PDF, JPEG, PNG e WEBP.
- Limite padrão de 10 MB.
- Valida o MIME informado e a assinatura real do arquivo.
- Gera nome aleatório no servidor; o nome original é apenas metadado.
- Armazena fora do diretório público, em `UPLOAD_DIR`.
- Diretórios com permissão restrita e arquivos com modo 0600 quando suportado.
- Download passa por autorização do usuário e proteção contra path traversal.
- Endpoint antigo de metadados arbitrários foi desativado.
- Exclusão de conta também remove os arquivos físicos associados.

### Banco
- Consultas existentes usam parâmetros, evitando concatenar entrada do usuário em SQL.
- Índices de autorização foram adicionados.
- `app_current_user_id()` foi preparada para uma futura adoção de Row-Level Security com contexto transacional.

### Teste
Execute `node scripts/security-audit.mjs` dentro do backend. O script faz verificações estruturais simples; não substitui pentest, SAST/DAST ou revisão humana.

## Referência
As medidas seguem recomendações atuais da OWASP para upload seguro, validação de entrada e prevenção de SQL Injection.
