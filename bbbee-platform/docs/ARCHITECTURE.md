# Architecture

## 1. Layers and the rules between them

| Layer | Responsibility | Lives in | Hard rule |
|-------|----------------|----------|-----------|
| L1 Regulatory source of truth | Authoritative documents, addressable provisions, versioned scorecard configuration | `RegulatoryFramework/Document/Version/Provision`, `ScorecardTemplate/Element/Indicator`, `CalculationRule`, `RecognitionTable`, `EntityClassificationRule`; `src/lib/regulatory` | Nothing is active until APPROVED → PUBLISHED by someone with `regulatory:approve`. |
| L2 AI agents | Classify, extract, interpret, challenge | `src/lib/agents` | Output is schema-validated JSON; ids must reference supplied inputs; agents never produce points. |
| L3 Deterministic engine | All arithmetic | `src/lib/engine` (pure) + `src/lib/scoring.ts` (DB adapter) | Uses only `verifiedValue`s; unconfigured rules return `REGULATORY_CONFIGURATION_REQUIRED`; decimal maths. |
| L4 Human review | Confirmation, overrides, review, approval | `Override`, `TechnicalReview`, `VerificationSnapshot`, `AuditEvent`; `src/lib/overrides.ts` | Overrides keep the AI value; audit log and snapshots are append-only at DB level. |

## 2. Regulatory version control

* `RegulatoryVersion` has `[validFrom, validTo)`, `status`, `supersedes/supersededBy`, approval fields.
* `selectVersionForDate()` returns the PUBLISHED/SUPERSEDED version whose window covers the
  measurement-period end date. **There is no "latest" fallback** — no match means a human must resolve it.
  Overlapping in-force windows throw; publishing an overlapping window is refused.
* An engagement binds to one version (`confirmEngagementRegulatoryVersion`) only if that version is in force
  for its period. A scorecard refuses to mix rules from different versions.

## 3. Calculation engine

```
CalculationRule (versioned config) ─┐
                                    ├─► handler (PROPORTIONAL | BINARY_THRESHOLD | BANDED | CUSTOM_HANDLER)
CalculationInput.verifiedValue ─────┘       │
                                            ▼
                     raw → non-negative → cap → round → bonus → IndicatorResult + CalculationTrace
                                            ▼
              element totals → priority sub-minimum tests → recognition level → discount policy
```

* Formula parameters (`target`, `denominatorKey`, bands, thresholds, cap, bonus rule, rounding) are data.
  New shapes are added as named, reviewed `CUSTOM_HANDLER`s — never ad-hoc code paths.
* Every result carries a `CalculationTrace`: formula, inputs (verified **and** claimed, with evidence ids),
  target, actual, recognised amount, ratio, weighting, raw/capped/bonus points, rounding, result, provision ids.
* Fail-safe statuses: `REGULATORY_CONFIGURATION_REQUIRED`, `INSUFFICIENT_INPUTS` ("INSUFFICIENT EVIDENCE TO
  VERIFY"), `ERROR`. A scorecard with any non-calculated indicator never claims a level.

## 4. Agents and orchestration

* Contracts: `src/lib/agents/contracts.ts` (zod; also used to constrain Claude via structured outputs).
* Runner: data minimisation per agent (`accepts`), PII masking, untrusted-content wrapping with a per-call nonce,
  structured output, re-validation, referential checks (fabricated evidence/provision/document ids reject the
  run), AI-response cache keyed on the canonical input hash, `AgentRun` persistence and audit.
* Orchestrator: a static DAG (`PIPELINE`) — agents cannot call agents. `elementStagesAffectedBy()` computes the
  minimal set of stages to rerun when new evidence classes arrive (incremental reassessment).
* Model: `AGENT_MODEL` (default `claude-opus-5-5`), effort via `AGENT_EFFORT`; system prompts are byte-stable to
  benefit from prompt caching.

## 5. Document ingestion

`ingestFile()`: size limit → extension/magic-byte agreement → ClamAV scan (`NOT_SCANNED` ⇒ quarantine) →
SHA-256 → duplicate detection within the engagement → content-addressed, write-once storage → heuristic
classification (LOW confidence, human-correctable) → `Document` + `DocumentVersion` + audit, in one transaction.
ZIP packs are expanded with entry/size/ratio limits, traversal rejection and depth limit 2.

## 6. Tenancy and access

* `Organisation` = verification agency (tenant). Staff see their organisation only; `CLIENT_USER`s see only
  clients granted via `ClientUserAccess`. Out-of-scope records are reported as not found.
* RBAC permissions are per-organisation rows (`RolePermission`) seeded from `DEFAULT_ROLE_PERMISSIONS`.
  Technical review is separated from preparation (signatories cannot run calculations or override).

## 7. Key decisions

| Decision | Reason |
|----------|--------|
| Subdirectory `bbbee-platform/` in the existing repo | The repo held an unrelated app; kept it intact. |
| Prisma 6 (not 7/8-rc) | Stable, mature migration tooling; 8.x was release-candidate at build time. |
| Own session auth (opaque token, SHA-256 at rest, httpOnly cookie) | Full control over lockout, idle timeout, audit; no third-party identity dependency for MVP. SSO/OIDC can be added. |
| DB triggers for immutability | Application bugs or direct SQL cannot alter audit events, overrides, snapshots or document hashes. |
| `decimal.js` everywhere in the engine | Reproducible results to the cent; no float drift. |
| PostgreSQL FTS now, pgvector next | pgvector needs the extension provisioned (compose uses `pgvector/pgvector:pg16`). |
