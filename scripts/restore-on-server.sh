#!/usr/bin/env bash
# Restores a bundle made by export-for-server.sh into the server's (empty) database + public/uploads.
# Usage (on the server, in the backend folder, with Postgres running and Strapi stopped):
#   bash scripts/restore-on-server.sh deploy-bundle-XXXX.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
BUNDLE=${1:?usage: restore-on-server.sh deploy-bundle-XXXX.tar.gz}
TMP=$(mktemp -d)
tar -C "$TMP" -xzf "$BUNDLE"
TABLES=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_schema='"'"'public'"'"'"')
if [ "$TABLES" != "0" ]; then
  echo "✘ The database already has $TABLES tables. Restore only into an empty database (drop it first if you're sure)." >&2
  exit 1
fi
echo "• restoring database…"
docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$TMP/database.sql" > /dev/null
echo "• restoring uploads…"
mkdir -p public && tar -C public -xf "$TMP/uploads.tar"
rm -rf "$TMP"
echo "✔ restored — start Strapi with: pm2 start ecosystem.config.cjs"
