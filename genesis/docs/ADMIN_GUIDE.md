# Administrator guide

You hold ultimate authority over money, credentials, legal commitments and shutdown. Agents cannot change any of the settings below.

## Signing in
Open the dashboard and paste your `GENESIS_ADMIN_TOKEN`. A `GENESIS_VIEWER_TOKEN` gives read-only access (useful for an accountant).

## First run (simulation)
1. **Overview → Create the genesis agent.** Choose a strategy, optionally a market (leave "random" for an unbiased draw), and the virtual funding amount ($50 minimum).
2. **Controls → Administrator wallet.** Paste the *public* address of your USDC wallet and pick the network. Checksummed EVM addresses are verified. Never paste a private key or seed phrase anywhere.
3. **Controls → Simulation clock.** Advance by a day, a week or 30 days, or click *Start scheduler* (1 simulated hour per second).

## Reading the dashboard
* **Overview** — KPIs, net assets vs cumulative realised profit, weekly distributions and the next scheduled run (Sunday 23:59 SAST).
* **Agents** — sortable leaderboard. Click a row for the agent's objective, parameters, opportunity pipeline (assessment → test → evaluation), experiment history, lessons, model usage and recent decisions.
* **Family tree** — every agent, colour + label by status (living / suspended / terminated †). Click a node to inspect it.
* **Finance** — daily revenue vs expenses, costs by category, capital per agent, external transfers, full transaction history.
* **Activity** — the event feed (filter to warnings/critical for blocked actions and risk alerts).
* **Approvals** — decisions waiting for you: large or live payouts, agent-to-agent transfers, strategy authorisations, manual liquidations.
* **Audit** — the tamper-evident log; the header shows whether the hash chain is intact.

## Controls
| Action | Effect |
|---|---|
| Pause / Resume | stop / restart all agent activity and scheduled payouts |
| Emergency stop | pause + stop scheduler + deactivate live mode |
| Suspend / Resume / Terminate agent | from the agent detail panel; terminating sweeps remaining capital to the treasury |
| Policy and limits | max agents, births/day, aggregate capital, daily/weekly spend caps, max transaction, auto-payout limit, owner share, reproduction multiples, per-category daily budgets, model call limits |
| Run distribution now | closes the period at the current time (off-schedule) |
| Reconcile | checks the ledger against the chain, position sub-ledgers and invariants |
| Integrations | store encrypted credentials with scopes (values are write-only) |

## How money flows
* Revenue counts only with verified evidence (payment webhook, exchange fill). Agent-to-agent transfers, offspring funding and your contributions are never revenue.
* Costs you pay on the ecosystem's behalf (Claude, hosting, card fees) are tracked as **owed to operator** and reimbursed to your wallet every week **before** profit is shared.
* Each week: `distributable = cumulative realised profit − high-water mark`. You receive 50%; 50% stays in the ecosystem. Losses must be recovered before the next payout. Unrealised gains are never paid.

## Going live (Phase 7)
Live mode stays off until **Controls → Live mode** shows every check green:
1. `python -m genesis.simulate --verify` passes (records the result).
2. `GENESIS_ADMIN_TOKEN` and `GENESIS_MASTER_KEY` set.
3. Administrator wallet and treasury wallet configured.
4. External signing service configured (`GENESIS_SIGNER_URL`).
5. You clicked **Confirm limits**.
6. A clean reconciliation.
Then type `I AUTHORIZE LIVE TRANSACTIONS` and activate. In live mode every payout requires your approval.

Before enabling any live strategy you (not an agent) must open and own the required accounts — payment processor, exchange, hosting, domain — and handle tax registration where applicable. Strategies flagged public-facing or regulated wait in **Approvals** for your authorisation.

## Backups and recovery
* PostgreSQL: daily `pg_dump` (see DEPLOYMENT.md) and test restores monthly.
* The ledger is append-only; never edit rows by hand. Corrections are new balancing entries.
* If the audit chain check fails, stop the ecosystem and restore from the last good backup.
