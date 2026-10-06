/**
 * Date-validity helpers. All comparisons are on calendar dates (UTC midnight),
 * inclusive of both period bounds.
 */

export interface Period {
  start: Date;
  end: Date;
}

export function toUtcDate(d: Date | string): Date {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) throw new RangeError(`Invalid date: ${String(d)}`);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

export function isWithinPeriod(date: Date | string, period: Period): boolean {
  const d = toUtcDate(date).getTime();
  return d >= toUtcDate(period.start).getTime() && d <= toUtcDate(period.end).getTime();
}

export function addMonths(date: Date, months: number): Date {
  const d = toUtcDate(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

export type CertificateValidity = "VALID" | "EXPIRED" | "NOT_YET_VALID" | "MISSING_DATES" | "INVALID_DATES";

export interface CertificateDates {
  issueDate?: Date | string | null;
  expiryDate?: Date | string | null;
}

/** Was the certificate valid on the given date (e.g. the transaction date)? */
export function certificateValidityOn(cert: CertificateDates, onDate: Date | string): CertificateValidity {
  if (!cert.issueDate || !cert.expiryDate) return "MISSING_DATES";
  const issue = toUtcDate(cert.issueDate);
  const expiry = toUtcDate(cert.expiryDate);
  if (expiry.getTime() < issue.getTime()) return "INVALID_DATES";
  const on = toUtcDate(onDate).getTime();
  if (on < issue.getTime()) return "NOT_YET_VALID";
  if (on > expiry.getTime()) return "EXPIRED";
  return "VALID";
}

export interface AffidavitFacts {
  signedByDeponent: boolean;
  commissioned: boolean;
  commissionedDate?: Date | string | null;
  /** Validity period in months from commissioning — from regulatory configuration. */
  validityMonths: number | null;
}

export type AffidavitValidity = "VALID" | "UNSIGNED" | "NOT_COMMISSIONED" | "EXPIRED" | "MISSING_DATES" | "REGULATORY_CONFIGURATION_REQUIRED";

export function affidavitValidityOn(a: AffidavitFacts, onDate: Date | string): AffidavitValidity {
  if (!a.signedByDeponent) return "UNSIGNED";
  if (!a.commissioned) return "NOT_COMMISSIONED";
  if (!a.commissionedDate) return "MISSING_DATES";
  if (a.validityMonths == null) return "REGULATORY_CONFIGURATION_REQUIRED";
  const expiry = addMonths(toUtcDate(a.commissionedDate), a.validityMonths);
  return toUtcDate(onDate).getTime() <= expiry.getTime() ? "VALID" : "EXPIRED";
}
