# ◈ GENESIS AI

An autonomous, self-replicating AI economic ecosystem: AI agents start with $50 USDC, try to earn legitimate revenue, pay their own operating costs, reproduce when they reach strict capital thresholds, evolve their strategies, and share verified profit with their human owner every week.

**Current mode: SIMULATION.** All balances are virtual USDC until the administrator completes the live-mode checklist and explicitly authorises real transactions.

> Revenue is never guaranteed. In simulation most experiments fail; the system is built to fail cheaply, keep exact books, and only ever distribute realised, verified profit.

## What is implemented

| Area | Status |
|---|---|
| GENESIS CORE supervisor (deterministic rules, risk monitor, auto-suspend) | ✅ operational |
| Double-entry ledger (integer micro-USDC, idempotent, income-protected) | ✅ operational |
| Agent lifecycle: birth, suspension, insolvency termination with preserved records | ✅ operational |
| Reproduction engine: $500 first, capital-doubling thereafter, atomic & duplicate-proof | ✅ operational (tested concurrently on SQLite and PostgreSQL) |
| Weekly distribution: 50/50, high-water mark, operator reimbursement, Sunday 23:59 SAST | ✅ operational (simulated transfers) |
| Claude integration (strict tool, validation, cost metering, injection fencing, fallback) | ✅ implemented; exercised with a fake client in tests — **real calls need `ANTHROPIC_API_KEY`** |
| Strategies: AI research reports, micro-SaaS, unleveraged spot momentum, conservation | ✅ simulated; **live adapters await credentials** |
| Opportunity pipeline (assessment → small-scale test → evaluation), evolution, shared lessons | ✅ operational |
| Treasury: wallet validation (EIP-55, Solana), simulated chain, reconciliation | ✅ operational |
| Live signing service adapter | ⏳ interface + gate only; awaiting your signing service |
| Dashboard (overview, leaderboard, family tree, finance, activity, approvals, controls, audit) | ✅ operational, light/dark, mobile |
| Security: RBAC, encrypted scoped secrets, hash-chained audit log, rate limits, CSP | ✅ operational |
| PostgreSQL + Alembic migration, Docker Compose | ✅ migration verified on PostgreSQL 16; Docker image **not built here** (no Docker daemon in the build environment) |

See [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) for the full assessment.

## Quick start
```bash
cd genesis
pip install -r requirements-dev.txt
pytest -q                                            # 29 tests
export GENESIS_ADMIN_TOKEN=choose-a-long-random-token
uvicorn --factory genesis.api:get_app --port 8000    # http://localhost:8000
```
Sign in, create Agent 001, set your (public) wallet address, then advance the simulated clock.

## Layout
```
genesis/
  genesis/
    core.py            GENESIS CORE: rules, spending, revenue verification, reproduction, termination
    ledger.py          double-entry ledger and chart of accounts
    distribution.py    weekly profit distribution (HWM)
    orchestrator.py    scheduler + per-agent cycle + Toolbox (the only door strategies have)
    brain.py           ClaudeBrain (strict tool use) and HeuristicBrain
    strategies/        reviewed strategy plug-ins
    treasury.py        signers, simulated chain, reconciliation
    wallets.py         address/network validation (pure-Python Keccak-256)
    policy.py          administrator policy + ecosystem state
    security.py        RBAC tokens, encrypted vault, rate limiter
    live.py            live-mode readiness gate
    api.py             FastAPI routes;  static/  dashboard
    simworld.py        simulated markets & customer demand
    simulate.py        CLI: --verify and multi-seed reports
  migrations/          Alembic
  tests/               scenarios A–H, API, components, long-run invariants
  docs/                architecture, admin guide, deployment, simulation results, readiness
```

## Documentation
* [Architecture, contradictions resolved, schema, accounting model](docs/ARCHITECTURE.md)
* [Administrator guide](docs/ADMIN_GUIDE.md)
* [Installation & deployment](docs/DEPLOYMENT.md)
* [Simulation results](docs/SIMULATION_RESULTS.md)
* [Production-readiness assessment](docs/PRODUCTION_READINESS.md)
