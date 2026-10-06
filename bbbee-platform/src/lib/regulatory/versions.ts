import type { RegulatoryStatus } from "@prisma/client";

export interface VersionWindow {
  id: string;
  status: RegulatoryStatus;
  validFrom: Date | null;
  validTo: Date | null;
}

/** Statuses that represent rules that were in force (superseded rules still govern their own period). */
export const IN_FORCE_STATUSES: RegulatoryStatus[] = ["PUBLISHED", "SUPERSEDED"];

function day(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Select the regulatory version applicable on `date`: validFrom ≤ date < validTo.
 * Never falls back to "latest": no match → null (human must resolve).
 * Overlapping in-force windows are a configuration error and throw.
 */
export function selectVersionForDate<T extends VersionWindow>(versions: T[], date: Date): T | null {
  const t = day(date);
  const matches = versions.filter(
    (v) => IN_FORCE_STATUSES.includes(v.status) && v.validFrom != null && day(v.validFrom) <= t && (v.validTo == null || t < day(v.validTo)),
  );
  if (matches.length > 1) {
    throw new Error(`Overlapping in-force regulatory versions for ${date.toISOString().slice(0, 10)}: ${matches.map((m) => m.id).join(", ")}`);
  }
  return matches[0] ?? null;
}

export function windowsOverlap(a: Pick<VersionWindow, "validFrom" | "validTo">, b: Pick<VersionWindow, "validFrom" | "validTo">): boolean {
  if (!a.validFrom || !b.validFrom) return false;
  const aEnd = a.validTo ? day(a.validTo) : Infinity;
  const bEnd = b.validTo ? day(b.validTo) : Infinity;
  return day(a.validFrom) < bEnd && day(b.validFrom) < aEnd;
}

/** Spec §54: nothing becomes active without review and approval. */
export const REGULATORY_TRANSITIONS: Record<RegulatoryStatus, RegulatoryStatus[]> = {
  DRAFT: ["UNDER_REVIEW", "WITHDRAWN"],
  UNDER_REVIEW: ["APPROVED", "DRAFT", "WITHDRAWN"],
  APPROVED: ["PUBLISHED", "UNDER_REVIEW", "WITHDRAWN"],
  PUBLISHED: ["SUPERSEDED", "WITHDRAWN"],
  SUPERSEDED: [],
  WITHDRAWN: [],
};

export function canTransition(from: RegulatoryStatus, to: RegulatoryStatus): boolean {
  return REGULATORY_TRANSITIONS[from].includes(to);
}

/** Transitions requiring the REGULATORY_APPROVE permission rather than REGULATORY_MANAGE. */
export function requiresApprovalAuthority(to: RegulatoryStatus): boolean {
  return to === "APPROVED" || to === "PUBLISHED";
}
