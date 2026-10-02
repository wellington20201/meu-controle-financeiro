#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL não definida}"
: "${BACKUP_ENCRYPTION_PASSWORD_FILE:?BACKUP_ENCRYPTION_PASSWORD_FILE não definida}"
OUT_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$OUT_DIR/mcf-$STAMP.sql.gz"
OUT="$OUT_DIR/mcf-$STAMP.sql.gz.enc"
pg_dump "$DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$TMP"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$BACKUP_ENCRYPTION_PASSWORD_FILE" -in "$TMP" -out "$OUT"
rm -f "$TMP"
find "$OUT_DIR" -type f -name 'mcf-*.sql.gz.enc' -mtime +"$RETENTION_DAYS" -delete
echo "Backup criptografado criado: $OUT"
