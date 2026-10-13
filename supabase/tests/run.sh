#!/usr/bin/env bash
# Menjalankan migrasi + uji di PostgreSQL sementara. Butuh initdb/pg_ctl/psql (PostgreSQL 15+).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
TMP="$(mktemp -d)"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -A trust -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -p 55499 -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p 55499 -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/tests/stub_supabase.sql"
for f in "$ROOT"/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -t -f "$ROOT/tests/rls_and_rpc_test.sql" | grep -v "^\s*$"
