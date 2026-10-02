#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL não definida}"
: "${BACKUP_ENCRYPTION_PASSWORD_FILE:?BACKUP_ENCRYPTION_PASSWORD_FILE não definida}"
: "${1:?Informe o arquivo .sql.gz.enc}"
TMP="$(mktemp --suffix=.sql.gz)"
trap 'rm -f "$TMP"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$BACKUP_ENCRYPTION_PASSWORD_FILE" -in "$1" -out "$TMP"
gunzip -c "$TMP" | psql "$DATABASE_URL"
echo "Restauração concluída."
