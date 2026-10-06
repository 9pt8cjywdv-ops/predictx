# Security and POPIA controls

| Control | Implementation | Status |
|---------|----------------|--------|
| Encryption in transit | HSTS header; deploy behind TLS terminator; `COOKIE_SECURE=true` in production | Config |
| Encryption at rest | S3 SSE (`S3_SSE=AES256` or `aws:kms`); managed Postgres with storage encryption | Config |
| Authentication | bcrypt (cost 12), opaque 256-bit session tokens stored as SHA-256, httpOnly SameSite cookies, 12h absolute + 1h idle timeout | Done |
| Brute force | Per-IP and per-account rate limits; 5-failure lockout for 15 minutes; failed logins audited | Done (in-memory limiter; Redis for multi-instance) |
| RBAC | Configurable `RolePermission` matrix; server-side checks in every action/route | Done |
| Tenant isolation | Organisation scoping + explicit client grants; out-of-scope = 404 | Done, integration-tested |
| File security | Extension/magic-byte agreement, size limits, ClamAV INSTREAM, quarantine when unscanned, ZIP bomb/traversal defence, downloads as attachment with `nosniff` + sandbox CSP | Done |
| Immutable originals | Content-addressed write-once storage (`wx` / `If-None-Match: *`) + DB trigger on `DocumentVersion` | Done |
| Audit | Append-only, hash-chained `AuditEvent` (DB triggers, advisory-lock serialised), chain verification UI | Done |
| Security headers | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS | Done |
| Input validation | zod on every server action / service | Done |
| Secrets | Environment variables only; `.env` git-ignored; use a secrets manager in production | Config |
| Backups | Managed Postgres PITR + versioned object bucket (compose enables MinIO versioning) | Ops runbook pending |

## POPIA

* **Data minimisation to AI:** agents declare which input sections they accept; SA ID numbers (Luhn-validated),
  bank accounts, emails and phone numbers are masked before any content is sent to Claude.
* **No demographic inference:** prompts forbid inferring race/gender/disability from names; schema fields record
  only evidenced demographics (`blackStatusEvidenced`, `demographicsEvidenced`).
* **Purpose limitation & access:** RBAC + tenancy; client users cannot see internal commentary
  (`commentary:view-internal`).
* **Retention:** `Client.retentionUntil`; soft deletion with reason; originals retained while retention applies.
  Deletion/erasure workflow and data-subject export are Phase 10 items.
* **Identity information:** `Employee.maskedIdNumber` only; full identity numbers are not stored in structured data.
