#!/usr/bin/env bash
# Nightly MySQL backup + restore verification. Cron: 0 3 * * * /srv/fixmyseo/deploy/backup.sh >> /var/log/fixmyseo-backup.log 2>&1
# Reads DB_* from the project .env. Keeps 14 days locally; copy $OUT off-site (rclone/scp) afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
OUT="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT/${DB_NAME:-fixmyseo}-$STAMP.sql.gz"

mysqldump --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" --password="$DB_PASSWORD" \
  --single-transaction --quick --routines --triggers "${DB_NAME:-fixmyseo}" | gzip -9 > "$FILE"
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Restore verification into a scratch database (proves the dump is loadable)
VERIFY_DB="${DB_NAME:-fixmyseo}_restore_check"
mysql --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" --password="$DB_PASSWORD" \
  -e "DROP DATABASE IF EXISTS \`$VERIFY_DB\`; CREATE DATABASE \`$VERIFY_DB\`;"
gunzip -c "$FILE" | mysql --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" --password="$DB_PASSWORD" "$VERIFY_DB"
TABLES=$(mysql --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" --password="$DB_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$VERIFY_DB'")
mysql --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" --user="$DB_USER" --password="$DB_PASSWORD" -e "DROP DATABASE \`$VERIFY_DB\`;"
echo "restore check ok: $TABLES tables"

find "$OUT" -name '*.sql.gz' -mtime +14 -delete
