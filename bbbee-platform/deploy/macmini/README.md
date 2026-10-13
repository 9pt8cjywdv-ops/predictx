# Running B-BBEE Verify on a Mac mini

This sets the Mac mini up as the live server for your office: the app, its PostgreSQL
database, malware scanning (ClamAV), HTTPS (Caddy) and nightly backups. Everything
starts automatically when the Mac's user logs in and restarts if it crashes.

## What you need

- A Mac mini on macOS 13 or later (Apple Silicon or Intel), on your office network, plugged in.
- An admin account on the Mac and about 10 GB free disk.
- [Homebrew](https://brew.sh) installed.
- **FileVault turned on** (System Settings → Privacy & Security → FileVault). Client files hold
  personal information; FileVault is what encrypts them at rest (POPIA).

## Install (about 15 minutes)

```bash
git clone https://github.com/9pt8cjywdv-ops/predictx.git ~/predictx
cd ~/predictx && git checkout claude/bbbee-verification-platform-lfoow4
bash bbbee-platform/deploy/macmini/install.sh
```

The installer asks for your agency name and the first administrator's name, email and password.
It prints the address when it finishes, e.g. `https://office-mac-mini.local`.

Then, once, so the server stays up:

```bash
sudo pmset -a sleep 0 disksleep 0 autorestart 1   # never sleep; power back on after an outage
```

and turn on **automatic login** for this user (System Settings → Users & Groups), because the
services start when the user logs in.

## Opening it from other computers

The Mac uses its own private certificate. On the Mac mini itself it is trusted automatically.
For each other computer on the office network, copy this file to it and trust it once:

```
~/Library/Application Support/Caddy/pki/authorities/local/root.crt
```

- **Mac:** double-click → Keychain Access → open the certificate → Trust → *Always Trust*.
- **Windows:** double-click → Install Certificate → Local Machine → *Trusted Root Certification Authorities*.

Then browse to `https://<mac-name>.local`.

**From outside the office** (e.g. working from home): don't open ports on your router.
Use [Tailscale](https://tailscale.com) on the Mac mini and each laptop instead; it gives a private,
encrypted link.

## Day to day

| Task | Command |
|------|---------|
| Is everything running? | `bash ~/predictx/bbbee-platform/deploy/macmini/status.sh` |
| Install an update | `bash ~/predictx/bbbee-platform/deploy/macmini/update.sh` (backs up first) |
| Restart the app | `launchctl kickstart -k gui/$(id -u)/za.bbbee.app` |
| Logs | `~/BBBEE/logs/` |

## Where the data lives

| What | Where |
|------|-------|
| Uploaded originals (never overwritten) | `~/BBBEE/storage/` |
| Database | PostgreSQL 16 (Homebrew), database `bbbee` |
| Backups (nightly 02:30, 30 days of DB dumps) | `~/BBBEE/backups/` |
| Configuration and DB password | `bbbee-platform/.env` (readable only by you) |

**A backup on the same Mac is not enough.** Plug in an external drive and set
`BBBEE_OFFSITE_DIR` in `launchd/za.bbbee.backup.plist` (e.g. `/Volumes/Backup`), or let
Time Machine back up the whole Mac, so a dead Mac mini doesn't take the evidence with it.

Restore a database dump:

```bash
pg_restore --clean --no-owner -d bbbee ~/BBBEE/backups/db/bbbee-YYYYMMDD-HHMMSS.dump
```

## Malware scanning

Uploads are scanned by ClamAV before they are stored. If ClamAV is not running, uploads are
**refused** (fail-safe) rather than stored unscanned. Signatures update daily at 01:15.

## AI agents

Add an Anthropic API key to `ANTHROPIC_API_KEY` in `.env` and restart the app when the
extraction agents (Phase 2) are switched on. Only masked excerpts are sent; see `docs/SECURITY-POPIA.md`.
