# Production-readiness assessment

Legend: **Operational** = implemented and covered by automated tests · **Simulated** = works against the simulation environment only · **Awaiting credentials** = code path/interface exists, needs an external account or key · **Incomplete** = not built yet.

## Feature status

| Feature | Status | Evidence / notes |
|---|---|---|
| Agent birth, IDs, lineage, generations, ledgers, profiles | Operational | Test A |
| Revenue / expense recording, budgets, no borrowing | Operational | Tests B, G |
| First reproduction at $500, $50 offspring, parent keeps $450 | Operational | Test C |
| Subsequent reproduction on capital doubling ($900 → $1,700 …) | Operational | Test D |
| Duplicate-birth prevention under concurrency | Operational | 6 concurrent threads, SQLite **and** PostgreSQL 16 |
| Proliferation limits (max agents, births/day, aggregate capital) | Operational | `test_g_proliferation_limits` |
| Insolvency termination, permission revocation, records preserved | Operational | Test F (never-profitable agent) |
| Weekly 50/50 distribution, HWM, loss recovery, idempotency, approvals | Operational (simulated transfers) | Tests E, E2, E3, E4 |
| Operator reimbursement of off-chain costs | Operational (simulated transfers) | Test E |
| Accounting integrity (transfers, funding, contributions, unrealised gains excluded) | Operational | Test H + 90-day invariant runs |
| Forged / replayed / circular revenue blocked | Operational | `test_g_forged_replayed_and_circular_revenue` |
| Audit hash chain + tamper detection | Operational | `test_g_audit_log_tamper_detection` |
| RBAC (admin / viewer), rate limiting, security headers | Operational | `test_api_end_to_end` |
| Encrypted, scoped secrets vault | Operational | `test_vault_scoping` |
| Wallet / network validation | Operational | EIP-55 reference vectors, Solana |
| Treasury reconciliation | Operational (simulated chain) | every long-run test |
| Emergency stop / pause / suspend / terminate | Operational | API test |
| Live-mode readiness gate + confirmation phrase | Operational | API test (correctly refuses) |
| Claude planning (strict tool, validation, clamping, fencing, fallback, cost metering) | Operational with a fake client; **real calls awaiting `ANTHROPIC_API_KEY`** | `test_claude_brain_*`. No live API call was made from this build environment. |
| Opportunity pipeline (assess → test → evaluate), evolution, inherited lessons | Operational | visible in dashboard / simulation |
| Strategy: AI research reports | Simulated; live adapter **awaiting credentials** (payment processor, storefront) | |
| Strategy: micro-SaaS | Simulated; live adapter **awaiting credentials** (payments, hosting, repo, domain) | |
| Strategy: unleveraged spot momentum | Simulated; live adapter **awaiting credentials** (exchange API) | |
| Live transaction signing | **Awaiting credentials** — `ExternalSignerAdapter` raises `NotConfigured` | needs your signing service |
| On-chain deposit verification / chain monitor | **Incomplete** — live contributions require a tx hash; reconciliation detects mismatches, but there is no RPC/indexer watcher yet | |
| Payment-webhook evidence verifiers (e.g. Stripe signature) | **Incomplete** — the `EvidenceSigner` interface is in place; per-provider verifiers are not written | |
| Agent-generated code review & isolated test pipeline | **Incomplete** — by design agents do not ship code today; strategies are reviewed plug-ins | |
| Dashboard (all sections, light/dark, mobile) | Operational | rendered and inspected at 1280px and 390px |
| PostgreSQL + Alembic | Operational | full suite + `alembic check` on PostgreSQL 16 |
| Docker image / Compose | **Not verified** — written but not built (no Docker daemon in the build environment) | |

## Known limitations and risks

1. **Real profitability is unproven.** The simulation's demand model is an assumption. Expect most real experiments to lose small amounts.
2. **Legal identity.** Every live revenue rail requires accounts in the administrator's name (KYC, ToS, tax). Agents cannot and must not open them.
3. **Single process.** One app instance runs the scheduler. Running two instances would double-tick agents. The DB guards prevent double births and double payouts, but costs could be double-charged. Keep one replica.
4. **Strategy code is trusted.** Strategies run in-process. Isolation comes from code review and the Toolbox interface, not an OS sandbox. Review any new strategy like production finance code.
5. **Brain selection at startup.** Switching to live mode or adding an API key takes effect on restart.
6. **Floating-point quantities** are used for crypto position *quantities* (money stays in integer micro-USDC). The rounding effect is sub-micro-dollar per trade, and positions are reconciled against cost basis.
7. **USDC contract addresses** in `wallets.py` must be re-verified against Circle's official list before live use.

## Recommended next steps before real money
1. Choose the network and signing provider; implement `ExternalSignerAdapter` against it, with an allow-list and caps enforced by the provider.
2. Pick **one** live strategy (suggested: AI research reports via a payment link) and implement its payment-webhook verifier plus a small daily budget.
3. Deploy with Docker Compose behind TLS; run `python -m genesis.simulate --verify`; confirm limits; reconcile; activate live mode with a $50 contribution.
4. Run 4–8 weeks, review every weekly report, then decide whether to widen limits.
