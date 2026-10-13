#!/usr/bin/env bash
# Pull the latest code, back up, migrate, rebuild and restart.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
cd "$APP_DIR"

echo "==> Backing up before update"
bash deploy/macmini/backup.sh

echo "==> Fetching latest code"
git pull --ff-only

echo "==> Installing, migrating, building"
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
NEXT_TELEMETRY_DISABLED=1 npm run build

echo "==> Restarting"
launchctl kickstart -k "gui/$(id -u)/za.bbbee.app"
for _ in {1..60}; do curl -fs http://127.0.0.1:3100/api/health >/dev/null && { echo "Updated and running."; exit 0; }; sleep 2; done
echo "App did not come back; see ~/BBBEE/logs/app.err.log" >&2
exit 1
