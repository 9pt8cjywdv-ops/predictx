import { dec } from "./engine/decimal";
import { certificateValidityOn, isWithinPeriod, toUtcDate, type Period } from "./engine/validity";

/**
 * Deterministic professional-scepticism checks (spec §35). These never conclude
 * fraud or fronting; each flag is a POTENTIAL VERIFICATION RISK for a human.
 */
export const RISK_LABEL = "POTENTIAL VERIFICATION RISK";

export type RiskCode =
  | "DUPLICATE_INVOICE"
  | "REUSED_PROOF_OF_PAYMENT"
  | "OUTSIDE_MEASUREMENT_PERIOD"
  | "NEAR_YEAR_END_PAYMENT"
  | "DUPLICATE_LEARNER"
  | "CERTIFICATE_INVALID_ON_TRANSACTION_DATE"
  | "CERTIFICATE_ENTITY_MISMATCH"
  | "REVERSED_TRANSACTION";

export interface RiskFlag {
  label: typeof RISK_LABEL;
  code: RiskCode;
  description: string;
  itemIds: string[];
}

export interface ClaimItem {
  id: string;
  counterparty: string;
  invoiceReference?: string | null;
  amount: string;
  date: string | Date;
  proofOfPaymentRef?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\(pty\)|ltd|limited|\binc\b|[^a-z0-9]/g, "");

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

export function checkClaims(items: ClaimItem[], period: Period, opts: { nearYearEndDays: number }): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const flag = (code: RiskCode, description: string, itemIds: string[]) => flags.push({ label: RISK_LABEL, code, description, itemIds });

  for (const [, g] of groupBy(items, (i) => (i.invoiceReference ? `${norm(i.counterparty)}|${norm(i.invoiceReference)}` : null))) {
    if (g.length > 1) flag("DUPLICATE_INVOICE", `Invoice ${g[0]!.invoiceReference} from ${g[0]!.counterparty} is claimed ${g.length} times.`, g.map((i) => i.id));
  }
  for (const [, g] of groupBy(items, (i) => (i.invoiceReference ? null : `${norm(i.counterparty)}|${dec(i.amount).toFixed(2)}|${toUtcDate(i.date).toISOString()}`))) {
    if (g.length > 1) flag("DUPLICATE_INVOICE", `${g.length} unreferenced claims to ${g[0]!.counterparty} share the same amount and date.`, g.map((i) => i.id));
  }
  for (const [ref, g] of groupBy(items, (i) => (i.proofOfPaymentRef ? norm(i.proofOfPaymentRef) : null))) {
    if (g.length > 1) flag("REUSED_PROOF_OF_PAYMENT", `Proof of payment ${ref} supports ${g.length} separate claims.`, g.map((i) => i.id));
  }
  const end = toUtcDate(period.end).getTime();
  for (const i of items) {
    if (!isWithinPeriod(i.date, period)) {
      flag("OUTSIDE_MEASUREMENT_PERIOD", `Claim dated ${toUtcDate(i.date).toISOString().slice(0, 10)} falls outside the measurement period.`, [i.id]);
    } else if ((end - toUtcDate(i.date).getTime()) / 86400_000 < opts.nearYearEndDays) {
      flag("NEAR_YEAR_END_PAYMENT", `Claim dated within ${opts.nearYearEndDays} days of the measurement period end.`, [i.id]);
    }
    if (dec(i.amount).isNegative()) flag("REVERSED_TRANSACTION", "Negative amount indicates a reversal or credit note.", [i.id]);
  }
  return flags;
}

export interface LearnerClaim {
  id: string;
  learnerRef: string;
  programme: string;
}

export function checkLearners(claims: LearnerClaim[]): RiskFlag[] {
  return [...groupBy(claims, (c) => `${norm(c.learnerRef)}|${norm(c.programme)}`).values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      label: RISK_LABEL,
      code: "DUPLICATE_LEARNER" as const,
      description: `Learner ${g[0]!.learnerRef} is claimed ${g.length} times for ${g[0]!.programme}.`,
      itemIds: g.map((c) => c.id),
    }));
}

export interface SupplierCertificateCheck {
  id: string;
  supplierName: string;
  certificateEntityName: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  transactionDates: string[];
}

export function checkSupplierCertificates(items: SupplierCertificateCheck[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const s of items) {
    if (s.certificateEntityName && norm(s.certificateEntityName) !== norm(s.supplierName)) {
      flags.push({ label: RISK_LABEL, code: "CERTIFICATE_ENTITY_MISMATCH", description: `Certificate is issued to "${s.certificateEntityName}", not "${s.supplierName}".`, itemIds: [s.id] });
    }
    const bad = s.transactionDates.filter((d) => certificateValidityOn({ issueDate: s.issueDate, expiryDate: s.expiryDate }, d) !== "VALID");
    if (bad.length) {
      flags.push({ label: RISK_LABEL, code: "CERTIFICATE_INVALID_ON_TRANSACTION_DATE", description: `${bad.length} transaction(s) fall outside the certificate validity for ${s.supplierName}.`, itemIds: [s.id] });
    }
  }
  return flags;
}
