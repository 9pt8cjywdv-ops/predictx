import { prisma } from "../db";

export const HUMAN_CONFIRMATION_REQUIRED = "REGULATORY SOURCE REQUIRES HUMAN CONFIRMATION";

export interface CitationCheck {
  provisionId: string;
  valid: boolean;
  reason?: string;
  reference?: string;
  documentTitle?: string;
}

export interface ProvisionRecord {
  id: string;
  reference: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  status: string;
  document: { title: string; status: string };
}

/**
 * Pure check: every cited id must exist, be approved/published, and be in
 * effect on the measurement date. Anything else is flagged for a human.
 */
export function checkCitations(ids: string[], found: ProvisionRecord[], onDate: Date): CitationCheck[] {
  const byId = new Map(found.map((p) => [p.id, p]));
  const t = onDate.getTime();
  return [...new Set(ids)].map((id) => {
    const p = byId.get(id);
    if (!p) return { provisionId: id, valid: false, reason: `${HUMAN_CONFIRMATION_REQUIRED}: provision not in Regulatory Library.` };
    const base = { provisionId: id, reference: p.reference, documentTitle: p.document.title };
    if (!["APPROVED", "PUBLISHED", "SUPERSEDED"].includes(p.status) || !["APPROVED", "PUBLISHED", "SUPERSEDED"].includes(p.document.status)) {
      return { ...base, valid: false, reason: `${HUMAN_CONFIRMATION_REQUIRED}: provision/source not approved.` };
    }
    if ((p.effectiveFrom && p.effectiveFrom.getTime() > t) || (p.effectiveTo && p.effectiveTo.getTime() <= t)) {
      return { ...base, valid: false, reason: `${HUMAN_CONFIRMATION_REQUIRED}: provision not in effect on measurement date.` };
    }
    return { ...base, valid: true };
  });
}

export async function validateCitations(ids: string[], onDate: Date): Promise<CitationCheck[]> {
  if (ids.length === 0) return [];
  const found = await prisma.regulatoryProvision.findMany({
    where: { id: { in: ids } },
    select: { id: true, reference: true, effectiveFrom: true, effectiveTo: true, status: true, document: { select: { title: true, status: true } } },
  });
  return checkCitations(ids, found, onDate);
}
