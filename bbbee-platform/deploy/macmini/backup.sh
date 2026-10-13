#!/usr/bin/env bash
# Nightly backup: database dump + evidence store. Keeps 30 days of dumps.
# Set BBBEE_OFFSITE_DIR (e.g. an external drive) to also copy everything there.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${BBBEE_DATA_DIR:-$HOME/BBBEE}"
DEST="$DATA_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST/db" "$DEST/storage"

DATABASE_URL="$(grep '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '"')"
pg_dump --format=custom --no-owner --file="$DEST/db/bbbee-$STAMP.dump" "${DATABASE_URL%%\?*}"

# Originals are write-once and content-addressed, so a non-deleting mirror is a complete copy.
rsync -a "$DATA_DIR/storage/" "$DEST/storage/"

find "$DEST/db" -name 'bbbee-*.dump' -mtime +30 -delete

if [[ -n "${BBBEE_OFFSITE_DIR:-}" && -d "$BBBEE_OFFSITE_DIR" ]]; then
  rsync -a "$DEST/" "$BBBEE_OFFSITE_DIR/bbbee-backups/"
fi
echo "$(date '+%F %T') backup ok: bbbee-$STAMP.dump"
