import type { Prisma } from "@prisma/client";
import type { DbClient } from "./db";
import { canonicalJson, sha256Hex } from "./hash";

/** Spec §33 event catalogue. */
export const AuditEventType = {
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  CLIENT_CREATED: "CLIENT_CREATED",
  ENGAGEMENT_CREATED: "ENGAGEMENT_CREATED",
  ENGAGEMENT_STATUS_CHANGED: "ENGAGEMENT_STATUS_CHANGED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_DUPLICATE_DETECTED: "DOCUMENT_DUPLICATE_DETECTED",
  DOCUMENT_QUARANTINED: "DOCUMENT_QUARANTINED",
  DOCUMENT_DELETED: "DOCUMENT_DELETED",
  EXTRACTION: "EXTRACTION",
  EVIDENCE_CONFIRMED: "EVIDENCE_CONFIRMED",
  CLASSIFICATION_CHANGED: "CLASSIFICATION_CHANGED",
  CALCULATION_RUN: "CALCULATION_RUN",
  CALCULATION_RULE_CHANGED: "CALCULATION_RULE_CHANGED",
  QUERY_GENERATED: "QUERY_GENERATED",
  QUERY_RESOLVED: "QUERY_RESOLVED",
  MANUAL_OVERRIDE: "MANUAL_OVERRIDE",
  SCORE_CHANGED: "SCORE_CHANGED",
  TECHNICAL_REVIEW: "TECHNICAL_REVIEW",
  APPROVAL: "APPROVAL",
  REPORT_GENERATED: "REPORT_GENERATED",
  AGENT_RUN: "AGENT_RUN",
  REGULATORY_DOCUMENT_ADDED: "REGULATORY_DOCUMENT_ADDED",
  REGULATORY_STATUS_CHANGED: "REGULATORY_STATUS_CHANGED",
  REGULATORY_VERSION_CONFIRMED: "REGULATORY_VERSION_CONFIRMED",
  PERMISSION_CHANGED: "PERMISSION_CHANGED",
  USER_CREATED: "USER_CREATED",
} as const;
export type AuditEventType = (typeof AuditEventType)[keyof typeof AuditEventType];

export interface AuditInput {
  eventType: AuditEventType;
  organisationId?: string | null;
  engagementId?: string | null;
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ipAddress?: string | null;
}

// Arbitrary constant: serialises chain writers so prevHash is always the true predecessor.
const AUDIT_CHAIN_LOCK = 0x0bbbee01;

export function computeAuditHash(prevHash: string | null, body: Record<string, unknown>): string {
  return sha256Hex(`${prevHash ?? "GENESIS"}|${canonicalJson(body)}`);
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/**
 * Append a tamper-evident audit event. Must be called inside the same
 * transaction as the change it records so the two commit atomically.
 */
export async function recordAudit(tx: DbClient, input: AuditInput) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
  const last = await tx.auditEvent.findFirst({ orderBy: { sequence: "desc" }, select: { hash: true } });
  const createdAt = new Date();
  const body = {
    eventType: input.eventType,
    organisationId: input.organisationId ?? null,
    engagementId: input.engagementId ?? null,
    userId: input.userId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    previousValue: toJson(input.previousValue) ?? null,
    newValue: toJson(input.newValue) ?? null,
    reason: input.reason ?? null,
    createdAt: createdAt.toISOString(),
  };
  const hash = computeAuditHash(last?.hash ?? null, body);
  return tx.auditEvent.create({
    data: {
      ...body,
      previousValue: body.previousValue ?? undefined,
      newValue: body.newValue ?? undefined,
      ipAddress: input.ipAddress ?? null,
      prevHash: last?.hash ?? null,
      hash,
      createdAt,
    },
  });
}

/** Re-walk the chain; returns the first sequence number whose hash does not verify. */
export async function verifyAuditChain(db: DbClient): Promise<{ ok: boolean; brokenAt?: bigint; checked: number }> {
  const events = await db.auditEvent.findMany({ orderBy: { sequence: "asc" } });
  let prev: string | null = null;
  for (const e of events) {
    const body = {
      eventType: e.eventType,
      organisationId: e.organisationId,
      engagementId: e.engagementId,
      userId: e.userId,
      entityType: e.entityType,
      entityId: e.entityId,
      previousValue: e.previousValue ?? null,
      newValue: e.newValue ?? null,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    };
    if (e.prevHash !== prev || computeAuditHash(prev, body) !== e.hash) {
      return { ok: false, brokenAt: e.sequence, checked: events.length };
    }
    prev = e.hash;
  }
  return { ok: true, checked: events.length };
}
