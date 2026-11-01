#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <source-database-url> <empty-restore-database-url>" >&2
  exit 2
fi

source_url=$1
restore_url=$2
backup_file=$(mktemp "${TMPDIR:-/tmp}/cotab-backup.XXXXXX.dump")
trap 'rm -f "$backup_file"' EXIT

command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }

echo "Creating a consistent custom-format backup..."
pg_dump --format=custom --no-owner --no-acl --dbname="$source_url" --file="$backup_file"
pg_restore --list "$backup_file" >/dev/null

echo "Restoring into the disposable target database..."
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error \
  --dbname="$restore_url" "$backup_file"

table_count=$(psql "$restore_url" -XAtqc \
  "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
alembic_version=$(psql "$restore_url" -XAtqc \
  "select version_num from alembic_version limit 1")

if [[ "$table_count" -lt 1 || -z "$alembic_version" ]]; then
  echo "Restore verification failed: tables=$table_count alembic_version=${alembic_version:-missing}" >&2
  exit 1
fi

echo "Restore verified: $table_count public tables, migration $alembic_version"
