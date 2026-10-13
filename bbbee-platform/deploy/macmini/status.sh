#!/usr/bin/env bash
# Quick health report for the Mac mini deployment.
for svc in app caddy clamd; do
  if launchctl print "gui/$(id -u)/za.bbbee.$svc" 2>/dev/null | grep -q 'state = running'; then s=running; else s=STOPPED; fi
  printf '%-8s %s\n' "$svc" "$s"
done
printf '%-8s %s\n' health "$(curl -fs http://127.0.0.1:3100/api/health || echo UNREACHABLE)"
printf '%-8s %s\n' backup "$(ls -t "${BBBEE_DATA_DIR:-$HOME/BBBEE}"/backups/db 2>/dev/null | head -1 || echo none)"
