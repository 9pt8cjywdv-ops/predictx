/**
 * POPIA data minimisation before content leaves the platform (spec §45–46).
 * Masks SA ID numbers, bank account numbers, emails and phone numbers. Masking
 * is deterministic per value within a request so the model can still match
 * repeated references ("ID#1") without seeing the identifier.
 */

export function isValidSaIdNumber(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  // Luhn checksum
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export interface MaskResult {
  text: string;
  counts: Record<"ID_NUMBER" | "BANK_ACCOUNT" | "EMAIL" | "PHONE", number>;
}

export function maskPersonalInformation(input: string): MaskResult {
  const counts: MaskResult["counts"] = { ID_NUMBER: 0, BANK_ACCOUNT: 0, EMAIL: 0, PHONE: 0 };
  const tokens = new Map<string, string>();
  const token = (kind: keyof MaskResult["counts"], value: string) => {
    const k = `${kind}:${value}`;
    if (!tokens.has(k)) {
      counts[kind] += 1;
      tokens.set(k, `[${kind}#${counts[kind]}]`);
    }
    return tokens.get(k)!;
  };

  let text = input.replace(/\b\d{13}\b/g, (m) => (isValidSaIdNumber(m) ? token("ID_NUMBER", m) : m));
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => token("EMAIL", m));
  text = text.replace(
    /\b(acc(?:ount)?\.?\s*(?:no\.?|number|#)?\s*[:-]?\s*)(\d[\d\s-]{6,18}\d)\b/gi,
    (_m, prefix: string, num: string) => `${prefix}${token("BANK_ACCOUNT", num.replace(/[\s-]/g, ""))}`,
  );
  text = text.replace(/(?:\+27|\b0)(?:[\s-]?\d){9}\b/g, (m) => token("PHONE", m.replace(/[\s-]/g, "")));
  return { text, counts };
}
