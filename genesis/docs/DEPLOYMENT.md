# Installation and deployment

## Local development (no Docker)
```bash
cd genesis
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export GENESIS_ADMIN_TOKEN=$(python -c "import secrets;print(secrets.token_urlsafe(32))")
uvicorn --factory genesis.api:get_app --reload --port 8000
# open http://localhost:8000 and sign in with $GENESIS_ADMIN_TOKEN
```
SQLite (`./genesis.db`) and the simulated clock are the defaults.

## Tests and simulation
```bash
pytest -q                                   # 29 tests: scenarios A–H, API/RBAC, Claude integration, invariants
GENESIS_TEST_DATABASE_URL=postgresql+psycopg://user@host/db pytest -q   # same suite on PostgreSQL (drops tables!)
python -m genesis.simulate --verify         # run suite and record the result for the live-mode gate
python -m genesis.simulate --days 365 --seeds 1,2,3 --report docs/SIMULATION_RESULTS.md
```

## Production (single VM, Docker Compose)
Requirements: a small Linux VM (1 vCPU / 1 GB is enough initially), Docker, a domain with TLS.

```bash
cp .env.example .env      # fill in POSTGRES_PASSWORD, GENESIS_ADMIN_TOKEN, GENESIS_VIEWER_TOKEN, GENESIS_MASTER_KEY
docker compose up -d --build
docker compose logs -f app
```
The container runs `alembic upgrade head` and then the API. Port 8000 is bound to localhost only; put a TLS reverse proxy in front, e.g. Caddy:
```
genesis.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

### Real-time operation
Set `GENESIS_SIM_CLOCK=false`, `GENESIS_AUTOSTART=true`, `GENESIS_TICK_SECONDS=3600`. Run **one** app instance (the scheduler is in-process and is the single writer loop).

### Enabling Claude
Set `ANTHROPIC_API_KEY`. In simulation, real calls are made only if `GENESIS_SIM_USE_CLAUDE=true` (costs real money while balances are virtual). Model choice and per-agent call limits are in the policy.

### Backups
```bash
docker compose exec db pg_dump -U genesis -Fc genesis > backup-$(date +%F).dump        # daily via cron
docker compose exec -T db pg_restore -U genesis -d genesis --clean < backup-YYYY-MM-DD.dump
```
Keep `GENESIS_MASTER_KEY` in a password manager. Without it, stored integration credentials cannot be decrypted (re-enter them).

### Monitoring
* `GET /api/health` (Docker HEALTHCHECK uses it).
* Watch the Activity feed for `critical` events; `GET /api/audit/verify` should always return `ok: true`.
* Daily cost report: `GET /api/costs?days=1`.

## Live deployment checklist
1. Choose the network (default Base) and create the treasury wallet **inside your signing service** (Safe with a GENESIS module, Coinbase CDP server wallet, Fireblocks, or an HSM-backed signer). Configure its allow-list: payouts only to your administrator wallet; per-transfer and daily caps.
2. Implement / configure the signing-service adapter (`genesis/treasury.py: ExternalSignerAdapter`) and set `GENESIS_SIGNER_URL`.
3. Open the business accounts strategies need (payment processor, exchange, hosting, domain) in your name; store their API keys under **Integrations** with narrow scopes; implement each strategy's live adapter and webhook verifier.
4. Run `python -m genesis.simulate --verify`, confirm limits, reconcile, then activate live mode from the dashboard.
