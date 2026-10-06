# B-BBEE Verify — AI-assisted B-BBEE verification management platform

A professional, auditable verification management application for South African
B-BBEE verification agencies. It ingests a client's verification file, manages
evidence with full lineage, applies a versioned regulatory framework, calculates a
**provisional** scorecard with a deterministic engine, and routes everything through
human review.

> **Legal boundary.** The platform produces *PROVISIONAL VERIFIED SCORES* and
> *AI-ASSISTED VERIFICATION RESULTS*. It never issues certificates. Verification
> Manager review and Technical Signatory sign-off remain human-controlled steps.

## Architecture in one picture

```
 L1 Regulatory source of truth ── versioned Codes, provisions, rules, recognition tables (approval workflow)
          │ (rules + provisions, by version in force for the measurement period)
 L2 AI verification agents ────── Claude: classify, extract, interpret → validated JSON only (no points)
          │ (structured, human-confirmed inputs + evidence links)
 L3 Deterministic engine ──────── decimal arithmetic, data-driven formula handlers, full traces
          │ (scores with lineage)
 L4 Human review ──────────────── overrides (append-only), technical review, immutable snapshots, audit chain
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/LINEAGE.md`](docs/LINEAGE.md),
[`docs/SECURITY-POPIA.md`](docs/SECURITY-POPIA.md) and the phase report
[`docs/PHASE-1-REPORT.md`](docs/PHASE-1-REPORT.md).

## Stack

Next.js 15 (App Router, React 19, TypeScript) · Tailwind · PostgreSQL 16 · Prisma 6 ·
S3-compatible object storage (local driver for development) · ClamAV · Anthropic Claude API
(structured outputs) · Vitest.

## Getting started

```bash
cd bbbee-platform
cp .env.example .env            # set DATABASE_URL etc.
npm ci
npx prisma migrate deploy       # schema + immutability triggers + FTS index
npm run db:seed                 # demo agency, users, regulatory skeleton (no regulatory values)
npm run dev                     # http://localhost:3100
```

Seeded users (password `Verify-Dev-2026!` unless `SEED_PASSWORD` is set):

| Role | Email |
|------|-------|
| Administrator | admin@agency.test |
| Verification Manager | manager@agency.test |
| Verification Analyst | analyst@agency.test |
| Technical Signatory | signatory@agency.test |
| Read-only Reviewer | reviewer@agency.test |
| Client User | client@client.test |

Full stack (Postgres + pgvector, MinIO, ClamAV, app): `docker compose up --build`.

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Unit, golden-case, adversarial **and** DB integration tests |
| `npm run test:unit` | Unit + golden + adversarial only (no DB) |
| `npm run test:integration` | Integration tests (needs `TEST_DATABASE_URL`, DB name must contain `test`) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run build` | Production build (standalone output) |

## Repository layout

```
prisma/                 schema, migrations (incl. DB-level immutability triggers), seed
src/lib/engine/         Layer 3 — deterministic calculation engine (pure, no I/O)
src/lib/regulatory/     Layer 1 — version selection, approval workflow, citations, search
src/lib/agents/         Layer 2 — agent contracts, prompt-injection guard, PII masking, runner, orchestrator
src/lib/ingestion/      upload pipeline: sniffing, malware scan, hashing, dedupe, ZIP expansion, classification
src/lib/                audit chain, RBAC, tenancy, overrides, lineage, scoring adapter, scepticism checks
src/app/                UI (server components + server actions) and API routes
tests/                  unit · golden · adversarial · integration
```

## Regulatory content policy

No B-BBEE target, weighting, threshold, recognition level, Gazette number or effective
date is hard-coded or seeded. Every such value must be captured in the Regulatory Library
from an uploaded authoritative source and approved; until then it is marked
`REGULATORY_CONFIGURATION_REQUIRED` and blocks calculation.
