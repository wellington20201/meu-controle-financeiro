# Meu Controle Financeiro — Frontend V2.3

Frontend React/Vite/PWA com autenticação por sessão segura.

## Segurança
- Não armazena token de autenticação em `localStorage`.
- Usa cookies de sessão enviados com `credentials: include`.
- Obtém e envia token CSRF nas operações de escrita.
- Cadastro exige senha com pelo menos 12 caracteres.
- Logout encerra a sessão no servidor.
- Lançamentos e recorrências exigem confirmação explícita na interface.

## Ambiente
`VITE_API_URL` deve apontar para a API, por exemplo `http://localhost:3333/api` em desenvolvimento.


## V2.5
O backend agora exige upload seguro para anexos. O frontend deve usar `/api/anexos/upload` com `multipart/form-data` e enviar `pagamento_id` + arquivo.
