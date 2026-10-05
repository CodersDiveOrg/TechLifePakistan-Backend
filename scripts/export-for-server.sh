#!/usr/bin/env bash
# Bundles the local database + uploaded media so the server starts with the same products,
# settings, admin account and orders.  Usage (on your computer):  pnpm export:server
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y%m%d-%H%M)
TMP=$(mktemp -d)
echo "• dumping database…"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' > "$TMP/database.sql"
echo "• copying uploads…"
tar -C public -cf "$TMP/uploads.tar" uploads
tar -C "$TMP" -czf "deploy-bundle-$STAMP.tar.gz" database.sql uploads.tar
rm -rf "$TMP"
echo "✔ deploy-bundle-$STAMP.tar.gz ($(du -h "deploy-bundle-$STAMP.tar.gz" | cut -f1)) — copy it to the server and run scripts/restore-on-server.sh"
