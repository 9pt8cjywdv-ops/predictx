#!/usr/bin/env bash
# B-BBEE Verify — Mac mini installer.
# Run from anywhere:  bash bbbee-platform/deploy/macmini/install.sh
# Safe to re-run: every step checks what already exists.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${BBBEE_DATA_DIR:-$HOME/BBBEE}"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
PORT=3100
DB_NAME=bbbee
DB_USER=bbbee

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "This installer is for macOS."
command -v brew >/dev/null || die 'Homebrew is required. Install it first:
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
BREW="$(brew --prefix)"

say "Installing dependencies (Node 22, PostgreSQL 16, ClamAV, Caddy)"
brew install node@22 postgresql@16 clamav caddy
NODE_BIN="$(brew --prefix node@22)/bin"
PG_BIN="$(brew --prefix postgresql@16)/bin"
export PATH="$NODE_BIN:$PG_BIN:$PATH"

mkdir -p "$DATA_DIR"/{storage,backups,logs,clamav} "$LAUNCH_DIR"
chmod 700 "$DATA_DIR"

if [[ "$(fdesetup status 2>/dev/null)" != *"On"* ]]; then
  warn "FileVault is OFF. Client evidence will sit unencrypted on disk. Turn it on in System Settings → Privacy & Security → FileVault."
fi

say "Starting PostgreSQL"
brew services start postgresql@16 >/dev/null
for _ in {1..30}; do pg_isready -q && break; sleep 1; done
pg_isready -q || die "PostgreSQL did not start."

ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  say "Creating database and configuration"
  DB_PASS="$(openssl rand -hex 24)"
  if psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    psql -d postgres -qc "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'"
  else
    psql -d postgres -qc "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'"
  fi
  psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || createdb -O "$DB_USER" "$DB_NAME"

  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public"
SESSION_TTL_HOURS=12
COOKIE_SECURE=true
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=$DATA_DIR/storage
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
MAX_UPLOAD_BYTES=104857600
MAX_ZIP_ENTRIES=2000
MAX_ZIP_UNCOMPRESSED_BYTES=1073741824
# Add your key to enable the AI agents (Phase 2+):
ANTHROPIC_API_KEY=
AGENT_MODEL=claude-opus-5-5
AGENT_EFFORT=high
ENV
  chmod 600 "$ENV_FILE"
else
  say "Keeping existing $ENV_FILE"
fi

say "Configuring ClamAV (malware scanning)"
CLAM_ETC="$BREW/etc/clamav"
if [[ ! -f "$CLAM_ETC/freshclam.conf" ]]; then
  sed -e 's/^Example/#Example/' "$CLAM_ETC/freshclam.conf.sample" > "$CLAM_ETC/freshclam.conf"
  echo "DatabaseDirectory $DATA_DIR/clamav" >> "$CLAM_ETC/freshclam.conf"
fi
if [[ ! -f "$CLAM_ETC/clamd.conf" ]]; then
  sed -e 's/^Example/#Example/' "$CLAM_ETC/clamd.conf.sample" > "$CLAM_ETC/clamd.conf"
  cat >> "$CLAM_ETC/clamd.conf" <<CONF
DatabaseDirectory $DATA_DIR/clamav
TCPSocket 3310
TCPAddr 127.0.0.1
StreamMaxLength 100M
LogFile $DATA_DIR/logs/clamd.log
CONF
fi
"$BREW/bin/freshclam" --config-file="$CLAM_ETC/freshclam.conf" || warn "freshclam could not update signatures now; it will retry daily."

say "Installing application packages and building"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
NEXT_TELEMETRY_DISABLED=1 npm run build

USER_COUNT="$(set -a; source "$ENV_FILE"; set +a; psql "${DATABASE_URL%%\?*}" -tAc 'SELECT count(*) FROM "User"')"
if [[ "$USER_COUNT" == "0" ]]; then
  say "Create your organisation and first administrator"
  read -r -p "Agency (organisation) name: " ORG_NAME
  read -r -p "Administrator full name: " ADMIN_NAME
  read -r -p "Administrator email: " ADMIN_EMAIL
  while true; do
    read -r -s -p "Administrator password (12+ chars, upper+lower case, a digit): " ADMIN_PASSWORD; echo
    read -r -s -p "Repeat password: " ADMIN_PASSWORD2; echo
    [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] && break
    warn "Passwords did not match."
  done
  SEED_MODE=production ORG_NAME="$ORG_NAME" ADMIN_NAME="$ADMIN_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" npx tsx prisma/seed.ts
  unset ADMIN_PASSWORD ADMIN_PASSWORD2
else
  say "Users already exist; skipping administrator setup"
fi

HOST_NAME="${BBBEE_HOSTNAME:-$(scutil --get LocalHostName | tr '[:upper:]' '[:lower:]').local}"
say "Configuring HTTPS for https://$HOST_NAME"
cat > "$DATA_DIR/Caddyfile" <<CADDY
{
  admin off
}
$HOST_NAME, localhost {
  tls internal
  encode gzip
  request_body {
    max_size 110MB
  }
  reverse_proxy 127.0.0.1:$PORT
  log {
    output file $DATA_DIR/logs/caddy-access.log
  }
}
CADDY
"$BREW/bin/caddy" trust >/dev/null 2>&1 || warn "Could not add Caddy's local certificate to this Mac's keychain (run: caddy trust)."

CLAMD_BIN=""
for c in "$BREW/sbin/clamd" "$BREW/bin/clamd"; do [[ -x "$c" ]] && { CLAMD_BIN="$c"; break; }; done
[[ -n "$CLAMD_BIN" ]] || die "clamd binary not found under $BREW."

say "Installing background services (start at login, restart on failure)"
render() {
  sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__DATA_DIR__#$DATA_DIR#g" -e "s#__NODE_BIN__#$NODE_BIN#g" \
      -e "s#__PG_BIN__#$PG_BIN#g" -e "s#__BREW__#$BREW#g" -e "s#__PORT__#$PORT#g" -e "s#__CLAMD__#$CLAMD_BIN#g" \
      "$APP_DIR/deploy/macmini/launchd/$1" > "$LAUNCH_DIR/$1"
  launchctl bootout "gui/$(id -u)/${1%.plist}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$LAUNCH_DIR/$1"
}
for svc in za.bbbee.clamd.plist za.bbbee.freshclam.plist za.bbbee.app.plist za.bbbee.caddy.plist za.bbbee.backup.plist; do
  render "$svc"
done

say "Waiting for the app"
for _ in {1..60}; do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 2; done
if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  say "B-BBEE Verify is running"
  cat <<DONE

  Open:        https://$HOST_NAME   (on this Mac: https://localhost)
  Logs:        $DATA_DIR/logs
  Data:        $DATA_DIR/storage   (originals)   ·  backups: $DATA_DIR/backups (nightly 02:30)
  Update:      bash $APP_DIR/deploy/macmini/update.sh

  Recommended once (needs your Mac password):
    sudo pmset -a sleep 0 disksleep 0 autorestart 1     # never sleep, restart after power loss
  and turn on automatic login for this user so services start after a reboot.
  Other computers on your network must trust this Mac's certificate — see deploy/macmini/README.md.
DONE
else
  die "The app did not respond. Check $DATA_DIR/logs/app.err.log"
fi
