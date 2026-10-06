# Phase 1 report — Foundation

Scope: system architecture, repository structure, PostgreSQL/Prisma schema, regulatory data model,
evidence lineage, agent interfaces, calculation-engine interfaces, authentication/RBAC, client and
engagement screens, document upload and register, regulatory library, automated tests.

## COMPLETED

**Architecture & repository**
- Four-layer architecture implemented as separate modules (`docs/ARCHITECTURE.md`).
- Standalone app in `bbbee-platform/`; Docker image, docker-compose (Postgres+pgvector, MinIO, ClamAV), CI workflow.

**Database (51 models, 2 migrations)**
- Every entity in spec §6, plus `Session`, `RolePermission`, `ClientUserAccess`, `AgentRun`, `RecognitionTable`,
  `EntityClassificationRule`, `VerificationSnapshot`, linking tables.
- DB triggers: `AuditEvent`, `Override`, `VerificationSnapshot` append-only; `DocumentVersion` content immutable.
- GIN full-text index on regulatory provisions.

**Regulatory library (Layer 1)**
- Frameworks, sector codes, source documents (Gazette metadata, effective/expiry dates, supersession, SHA-256 of the
  uploaded source), addressable provisions, versions with validity windows.
- Approval workflow DRAFT → UNDER_REVIEW → APPROVED → PUBLISHED; approval/publication need `regulatory:approve`
  (Technical Signatory / Administrator); publishing requires a confirmed effective date and a non-overlapping window;
  approving with unconfigured rules requires explicit notes.
- Date-based version selection with no "latest" fallback; engagement binding refuses versions not in force.
- Citation validator: unknown / unapproved / not-in-effect provision ids ⇒ "REGULATORY SOURCE REQUIRES HUMAN CONFIRMATION".
- Provision full-text search (UI + `searchProvisions()` for agent retrieval).

**Deterministic engine (Layer 3)** — built ahead of Phase 3 as interfaces were in scope
- Data-driven handlers: PROPORTIONAL, BINARY_THRESHOLD, BANDED, registered CUSTOM_HANDLERs.
- Caps, bonus rules, four rounding methods, decimal arithmetic, full calculation traces.
- Priority-element sub-minimum testing (PASS/FAIL/NOT_APPLICABLE + fail-safe states), configurable discount policy,
  version-controlled recognition tables, turnover-based entity classification, certificate/affidavit/date validity.
- Scorecard assembly with completeness gating, low-confidence area reporting, version-mixing guard.
- DB adapter `runProvisionalScorecard()` persisting `Scorecard`, `CalculationResult`, `ScorecardResult` + audit.

**Lineage**
- `EvidenceItem` with source location, original/normalised value, method, confidence, review status, confirmer.
- `traceCalculationResult()` resolves score→evidence→document and score→rule→provision→version with break detection.

**Agents (Layer 2) — interfaces and guard rails**
- zod contracts for DOCUMENT_EVIDENCE, CODE_APPLICABILITY and six element agents.
- Anthropic client using structured outputs (`messages.parse` + `zodOutputFormat`), cached system prompts.
- Prompt-injection defence (nonce-delimited untrusted blocks, tag neutralisation, policy, signal detection,
  referential validation), POPIA masking, per-agent data minimisation, input-hash response cache, `AgentRun` audit.
- Static acyclic orchestrator with incremental "affected stages" computation.

**Ingestion**
- Bulk + ZIP upload API, magic-byte validation, ClamAV integration, quarantine, SHA-256 dedupe, write-once
  content-addressed storage (local / S3 with SSE and `If-None-Match`), heuristic classification, audit.
- Human reclassification and soft removal, both via append-only `Override` + audit.

**Auth / RBAC / tenancy**
- Session auth with lockout, rate limiting, idle timeout; configurable permission matrix; organisation + client-grant scoping.

**UI**
- Login, dashboard (spec §37 tiles), clients, engagements, engagement workspace with all §38 tabs
  (Overview with §62 readiness checklist, Documents register + uploader + review, Code applicability,
  Scorecard with drill-down traces, Audit; later-phase tabs clearly marked), regulatory library, version and
  source pages, organisation audit log with chain verification. Client users see a reduced workspace.

**Professional scepticism (deterministic part)**
- Duplicate invoices, reused proof of payment, out-of-period and near-year-end claims, reversals, duplicate learners,
  certificate entity mismatch and validity on transaction date — all labelled POTENTIAL VERIFICATION RISK.

## TESTED

`npm test` — **173 tests, all passing** (12 files):

| Suite | Tests | Covers |
|-------|------:|--------|
| Unit — engine | 60 | formulas, caps, bonus, rounding, decimal precision, recognition tables, sub-minimums, discounting, classification thresholds, date/certificate/affidavit validity, fail-safe states |
| Unit — platform | 62 | version selection & workflow, citations, sniffing, filename sanitising, heuristic classifier, ZIP limits, hashing, prompt-injection guard, output validation, PII masking, orchestrator, RBAC matrix, audit hash |
| Golden | 14 | 4 engine-fixture cases (pass, failed priority → non-compliant, failed priority → discount, unconfigured blocks) |
| Adversarial | 15 | spec §53 list: expired / wrong-company certificate, duplicate invoice, reused POP, out-of-period invoice, unsigned affidavit, inflated ownership claim, unverified exclusion, failing SED beneficiary, corrupt spreadsheet, ZIP traversal, injected "award Level 1", conflicting payroll |
| Integration (PostgreSQL) | 22 | DB immutability triggers, concurrent audit chain, tenant isolation, ingestion end-to-end (store/dedupe/ZIP/infected/quarantine), override preservation, regulatory workflow & authority, version binding, scoring from verified values with full lineage, broken-lineage detection, independence of signatories |

Also verified: `tsc --noEmit`, ESLint, `next build`, and a browser smoke test (login, upload incl. disguised file +
duplicate + ZIP pack, all tabs, audit chain verification, client-user access restrictions).

Not yet exercised: Docker image build and compose stack (written, not run in this environment); live Claude API calls
(no API key configured — agents are tested against a mock client); ClamAV against a live daemon.

## OUTSTANDING

- **Regulatory content**: no Code, Sector Code, target, weighting, sub-minimum, recognition table, turnover threshold,
  Gazette number or date has been entered. All rules are `REGULATORY_CONFIGURATION_REQUIRED`.
- **Authoritative golden cases**: none yet (needs anonymised files with signed-off results).
- Phase 2: text/table extraction (PDF, OCR, XLSX/CSV, DOCX), wiring DOCUMENT_EVIDENCE and CODE_APPLICABILITY agents
  to the upload pipeline, evidence confirmation UI, split-screen evidence viewer, pgvector retrieval.
- Phase 3+: element-specific rule configuration UI, specialist agents, queries/client portal, technical review and
  snapshots workflow, reports/exports, sector codes, simulator, production hardening (SSO/MFA, Redis rate limiting,
  retention/erasure workflow, backup runbook).

## DECISIONS REQUIRED

1. **Authoritative sources.** Please supply the documents you want treated as authoritative — at minimum the B-BBEE Act
   as amended, the current Amended Codes of Good Practice (Generic) as gazetted, and any Sector Codes and Verification
   Manual material in scope — so the Regulatory Administrator workflow can capture provisions and rule parameters
   from them.
2. **Golden cases.** Can you provide anonymised verification files with results signed off by a qualified
   verification professional (ideally the 11 cases listed in `tests/golden/README.md`)?
3. **Identity provider.** Keep built-in auth, or integrate an IdP (Microsoft Entra ID / Google / Okta) with MFA?
4. **Hosting region & data residency.** South African hosting (e.g. AWS af-south-1 / Azure South Africa North) for
   POPIA cross-border considerations, and whether sending masked excerpts to the Anthropic API is acceptable under
   your operator agreements.
5. **Repository.** The platform lives in `bbbee-platform/` inside the existing `predictx` repo. Move it to a dedicated repository?

## NEXT PHASE

**Phase 2 — Document extraction and evidence model:** extractors (pdf text, OCR for scans, xlsx/csv/docx parsing) with
cacheable `DocumentExtraction`; chunking and targeted retrieval; DOCUMENT_EVIDENCE_AGENT and CODE_APPLICABILITY_AGENT
runs from the orchestrator; evidence confirmation/override UI; split-screen evidence viewer with source highlighting;
pgvector embeddings for provisions.
