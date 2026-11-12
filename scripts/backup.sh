#!/usr/bin/env bash
# Backup lógico do schema "draum" (dados + estrutura). Uso: npm run db:backup
# Restauração: psql "$DATABASE_URL" < backups/draum-AAAAMMDD-HHMM.sql
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ] && [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
: "${DATABASE_URL:?Defina DATABASE_URL}"
mkdir -p backups
FILE="backups/draum-$(date +%Y%m%d-%H%M).sql"
pg_dump "$DATABASE_URL" --schema=draum --no-owner --no-privileges --clean --if-exists > "$FILE"
pg_dump "$DATABASE_URL" --table=public.draum_migrations --no-owner --no-privileges --clean --if-exists >> "$FILE"
gzip -f "$FILE"
echo "Backup salvo em $FILE.gz"
