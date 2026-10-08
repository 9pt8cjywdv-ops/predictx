# GENESIS AI — Architecture

## 1. Feasibility assessment

| Requirement | Feasible? | Notes |
|---|---|---|
| Deterministic economic rules (birth, survival, reproduction, distribution) | **Yes — implemented** | Enforced in plain code (`core.py`, `distribution.py`) with DB constraints, not by an AI model. |
| Exact accounting, no double-counting, HWM distributions | **Yes — implemented** | Double-entry ledger in integer micro-USDC; income can only be created by verified external revenue or realized trading gains. |
| Agents reasoning with Claude | **Yes — implemented** | One strict tool (`submit_plan`); output is validated and clamped. Deterministic fallback brain. |
| Agents *autonomously earning real money* | **Partially, and only after human setup** | Every real revenue rail (Stripe, exchange accounts, domains, hosting) requires a legal identity, KYC and contract acceptance. Those must belong to the administrator. GENESIS provides the integration points and gating; it cannot lawfully open accounts by itself. |
| Real USDC custody and transfers | **Architected, awaiting credentials** | Signing is delegated to an external, policy-enforcing signer (Safe module / Coinbase CDP / Fireblocks / HSM). Keys never enter this process. |
| Profitability from $50 | **Not guaranteed — likely not** | At current prices a routine Claude Haiku 5.5 planning call costs ≈ $0.0005, so model cost is not the constraint; *demand* is. Most simulated niches fail, though cheap switching let every simulated ecosystem find one that sells; real markets are harsher. The system is designed to fail cheaply and keep the books exact. |
| Agent-written code deployed publicly | **Gated** | Strategy code is reviewed, version-controlled plug-ins. Agents choose and parameterise strategies; they do not self-modify production code. Public deployments require an administrator approval (security & compliance review). |

## 2. Contradictions and unresolved rules — and how they were resolved

1. **Operating costs are not paid in USDC.** Claude, hosting and card fees are billed to the administrator's card/bank, not to an on-chain wallet.
   *Resolution:* expenses paid off-chain debit the agent's allocation and are moved into a `reimbursement_reserve`; a matching `operator_payable` liability is repaid to the administrator wallet at each weekly settlement **before** any profit is distributed. The agent still "pays" from its own budget and the treasury stays reconcilable.
2. **Fiat revenue vs USDC accounting.** Stripe revenue lands in the administrator's bank. *Resolution:* revenue is recognised only on verified evidence (signed webhook / exchange fill). Live collected-to-wallet flow requires the administrator to convert and deposit, recorded as a receivable collection. Supported by the ledger (`receivable` accounts); live adapter awaiting credentials.
3. **"Capital reaches zero" is never exactly zero.** Spending more than available is refused (no borrowing), so balances asymptotically approach zero. *Resolution:* an agent is insolvent when its liquid capital (available + receivables + position value) falls below `insolvency_floor_usd` (default $0.05). An agent that can no longer afford its strategy's discretionary spend keeps paying unavoidable base costs until it crosses the floor.
4. **"Verified net operating capital" for reproduction.** *Resolution:* reproduction uses *available capital* = agent cash − agent payables. Open positions (at cost or market) and uncollected receivables are excluded — only unencumbered cash can fund a child.
5. **Thresholds when capital overshoots.** The spec's example uses exact numbers. *Resolution:* next threshold = `subsequent_multiple × capital retained immediately after the birth` (e.g. $520 → child, retained $470, next threshold $940). At most one birth per agent per cycle.
6. **Ecosystem-level profit vs agent-level cash.** Profit is computed ecosystem-wide but cash sits in agent sub-ledgers. *Resolution:* the payout is funded first from free treasury balance (e.g. estates of deceased agents), then by agents pro-rata to their positive realised profit in the period, never drawing any agent below `min_agent_reserve_usd`. Any shortfall carries forward (the HWM only advances by profit actually distributed against).
7. **Distribution reduces reproduction progress.** Paying 50% of an agent's profit out weekly slows its path to $500. This is an inherent consequence of the rules; it is visible on the dashboard and adjustable via `owner_profit_share_bps`.
8. **Approval vs automation for payouts.** *Resolution:* payouts ≤ `auto_payout_limit_usd` (default $100) execute automatically in simulation; larger payouts, and **all** payouts in live mode, create an approval. While a payout awaits approval, later periods are marked `deferred_pending_approval` so the same profit cannot be paid twice.
9. **"Maximum aggregate operating capital".** Reproduction is an internal transfer and does not change aggregate capital. *Resolution:* the cap blocks new allocations from the treasury and blocks births while the ecosystem is above it.
10. **Agents "may explore any lawful opportunity"** vs. "any activity requiring legal identity or contracts must be escalated". In practice almost every real revenue opportunity needs both. *Resolution:* agents can propose and assess any opportunity; activating anything that is public-facing, regulated, or needs new accounts creates an administrator approval.

## 3. Architecture

```
            ┌──────────────────────────── FastAPI process ───────────────────────────────┐
 Admin ───▶ │  api.py  (RBAC: admin/viewer, rate limit, security headers) + dashboard     │
 browser    │      │                                                                      │
            │      ▼                                                                      │
            │  GENESIS CORE (core.py) — deterministic supervisor                          │
            │   • lifecycle (birth / suspend / terminate)   • spend checks & budgets      │
            │   • revenue verification & anti-circularity  • reproduction engine (atomic) │
            │   • internal transfers (approval)            • opportunity pipeline         │
            │      │                 │                    │                               │
            │      ▼                 ▼                    ▼                               │
            │  Ledger (ledger.py)  Distribution engine   Treasury (treasury.py)           │
            │  double-entry        (HWM, weekly SAST)    Signer: Simulated | External      │
            │      │                                                                      │
            │  Orchestrator (orchestrator.py): hourly tick ─▶ per-agent cycle             │
            │      Strategy plug-ins ──(Toolbox: validated, agent-bound)──▶ CORE           │
            │      Brain: ClaudeBrain (strict tool) | HeuristicBrain (fallback)            │
            └──────────────────────────┬──────────────────────────────────────────────────┘
                                       ▼
                         PostgreSQL (prod) / SQLite (dev, tests)
```

**Technology choices**

* **Python 3.12 + FastAPI + SQLAlchemy 2 + PostgreSQL** — as recommended.
* **No Redis / Celery.** At this scale (tens of agents, hourly cycles) an in-process scheduler thread plus database row locks and unique constraints is simpler, cheaper (one small VM) and has fewer failure modes. The orchestrator is the only writer loop; if horizontal scaling is ever needed, the per-agent cycle is already a self-contained unit of work that can move to a job queue.
* **Dashboard: dependency-free HTML/JS served by the API** instead of Next.js. Justification: one container, no Node build pipeline, strict CSP (`default-src 'self'`), nothing to keep patched. The API is a clean JSON surface, so a Next.js front end can be added later without backend changes.
* **USDC on Base** as the default network (native USDC, low fees). Ethereum, Arbitrum, Optimism, Polygon and Solana are supported for address validation; the administrator chooses.

## 4. Database schema

17 tables (see `genesis/models.py`, migration `migrations/versions/0001_initial_schema.py`, PostgreSQL DDL in `docs/schema.postgresql.sql`).

| Table | Purpose |
|---|---|
| `agents` | identity (`AGT-0001`), parent, generation, status, starting capital, reproduction count, **next threshold**, capital after last reproduction, strategy profile (market, params, risk tolerance, experiments, state), permissions, budget overrides, final performance, optimistic-lock `version` |
| `journal_entries` / `journal_lines` | double-entry ledger; entries carry kind, evidence source, external ref, `idempotency_key` (unique), simulated flag |
| `positions` | open spot positions; cost basis mirrors the positions ledger account |
| `reproduction_events` | every birth; **unique (parent_id, seq)** and unique child |
| `distributions` | weekly computation: period, profit, cumulative, HWM before/after, owner/retained, status; **unique period_end** |
| `transfers` | external USDC movements (payout, reimbursement) with network, tx hash, status, simulated flag |
| `approvals` | administrator decisions (payouts, internal transfers, strategy authorisation, liquidation) |
| `audit_log` | append-only, SHA-256 hash-chained |
| `state` | administrator policy + ecosystem state (pause, live mode, wallet, HWM, schedule) |
| `agent_events`, `agent_memory`, `usage_records`, `opportunities` | activity feed, lessons, metered model usage, evaluation pipeline |
| `secrets` | Fernet-encrypted, scoped integration credentials |
| `sim_chain_balances`, `daily_snapshots` | simulated chain; dashboard time series |

## 5. Agent lifecycle

```
            contribute + allocate $50            available ≥ threshold & all checks pass
  (admin) ─────────────────────────▶ ACTIVE ───────────────────────────────▶ reproduce (child ACTIVE)
                                     │  ▲
                admin / auto-suspend │  │ admin resume
                                     ▼  │
                                  SUSPENDED
                                     │
   liquid capital < floor, or admin  ▼
                                  DECEASED  (permissions revoked, positions liquidated, payables settled,
                                             residual swept to treasury, final performance stored, records kept)
```

Each **hourly cycle** (only when something can change): strategy `on_hour` (trading) → daily `on_day` (business ops + base infra cost) → planning every `planning_interval_hours` (Claude/heuristic; cost pre-authorised against budget, then metered) → opportunity evaluation → insolvency check → reproduction check.

## 6. Financial accounting model

All amounts are integer micro-USDC. Every entry balances. Key postings:

| Event | Debit | Credit | Income? |
|---|---|---|---|
| Admin contribution | treasury | equity:contributed | no |
| Allocation / offspring funding / internal transfer / estate sweep | recipient cash | source cash / treasury | **no** (ledger refuses income lines on these kinds) |
| Verified sale | agent cash (or receivable) | income:revenue | yes — needs HMAC-verified evidence, unique reference, external payer |
| Off-chain expense | expense:cat + reimbursement_reserve | agent cash + operator_payable | — |
| On-chain expense | expense:cat | agent cash | — |
| Spot buy | positions + expense:trading_fees | agent cash | — |
| Spot sell | agent cash + fee (+ trading_loss) | positions (+ income:trading_gain) | realised only |
| Distribution | equity:distributions | agent cash / treasury | — |

`realized profit = income − expenses`. Unrealised P&L is computed from positions × mark price and never enters the ledger. Accounting identity checked in tests: **net assets = contributions + realised profit − distributions**.

**Distribution:** `distributable = max(0, cumulative realised profit − HWM)`; owner gets `floor(distributable × share_bps / 10 000)`; HWM advances only when paid. Scheduled for Sunday 23:59 Africa/Johannesburg (21:59 UTC), idempotent per period.

## 7. Reproduction engine

Checks (all deterministic): active & permitted · not paused · available ≥ threshold · parent keeps ≥ reserve after funding · active agents < max · births in 24 h < max · aggregate capital under cap · position sub-ledger reconciled · no pending internal transfers.

Atomicity: the parent row is locked (`SELECT … FOR UPDATE` on PostgreSQL; `BEGIN IMMEDIATE` write lock on SQLite), the optimistic `version` column rejects lost updates, `(parent_id, seq)` is unique, and the funding journal entry has idempotency key `repro:<parent>:<seq>`. Verified with 6 concurrent threads on both SQLite and PostgreSQL: exactly one birth.

Evolution: the child receives a controlled mutation — 20% different strategy, 40% different market, 40% parameter variation (±20–25%, clamped to declared bounds), risk tolerance ±0.05 within the admin cap — plus the parent's five most recent lessons.

## 8. Treasury architecture

* One master wallet per network; agents are ledger sub-accounts (no agent keys).
* `Transfer` rows record every external movement: created → simulated → submitted → confirmed / failed.
* `SimulatedSigner` moves balances on a simulated chain; every ledger entry's net wallet effect is mirrored there automatically, so reconciliation (`ledger wallet-held total == chain balance`) is meaningful in simulation.
* `ExternalSignerAdapter` is the live boundary (awaiting configuration). The signing service must enforce its own allow-list (administrator wallet only for payouts) and per-transfer caps — defence in depth beyond GENESIS's own checks.
* Address validation: EIP-55 checksum (pure-Python Keccak-256, tested against reference vectors), zero-address and token-contract rejection, Solana base58/32-byte check.

## 9. Security architecture

| Control | Implementation |
|---|---|
| Authentication / RBAC | Bearer tokens, constant-time hash comparison; `admin` vs read-only `viewer`. Agents have **no** API credentials. |
| Secrets | Fernet-encrypted at rest, scoped reads, write-only via API; never sent to the model. |
| Spending limits | per-agent per-category daily budgets, ecosystem daily/weekly caps, max transaction value, max position fraction, no leverage/shorting. |
| Revenue integrity | HMAC-signed evidence per source, replay protection (unique reference), anti-circularity (payer may not be an agent or treasury). |
| Ledger integrity | balanced entries only; internal kinds cannot touch income; idempotency keys. |
| Audit | SHA-256 hash chain; `GET /api/audit/verify` detects tampering. |
| Prompt injection | external text fenced in `<untrusted_data>` (fence cannot be closed early); one strict tool; output validated, clamped, enabled-strategies only; failures fall back to the heuristic. |
| Risk monitor | violations logged + audited; auto-suspend after N per day; losing-streak warnings. |
| Emergency shutdown | `POST /api/control/emergency-stop` halts the scheduler, pauses agents and deactivates live mode. |
| Web | rate limiting, CSP `default-src 'self'`, `X-Frame-Options: DENY`, no third-party scripts. |
| Agent code | strategies are reviewed plug-ins; agents cannot alter code, limits, payout share, wallets or other agents. |

## 10. Cost model (default policy)

* Base infrastructure share: $0.02 / agent / day.
* Routine planning: Claude Haiku 5.5 ($0.10 / $0.50 per MTok) ≈ $0.0005 per daily call; capped at `claude_max_calls_per_agent_per_day` and the `claude_api` daily budget ($0.50).
* Reasoning model (`claude-opus-5-5`) is configured for complex decisions; budget pre-authorisation uses the worst-case output length.
* A $5–10/month VPS + managed Postgres is sufficient for the initial deployment.
