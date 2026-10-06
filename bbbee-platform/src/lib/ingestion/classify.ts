import type { DocumentClass, ScorecardElementCode } from "@prisma/client";

/**
 * First-pass heuristic classifier on filename (and optional text sample).
 * Output is always LOW confidence and HEURISTIC-sourced; the DOCUMENT_EVIDENCE_AGENT
 * and humans refine it. Rules are ordered: more specific patterns first.
 */
interface Rule {
  documentClass: DocumentClass;
  element: ScorecardElementCode | null;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  { documentClass: "EEA4", element: "MANAGEMENT_CONTROL", patterns: [/\beea\s*-?\s*4\b/i, /income differential/i] },
  { documentClass: "EEA2", element: "MANAGEMENT_CONTROL", patterns: [/\beea\s*-?\s*2\b/i, /employment equity report/i] },
  { documentClass: "CIPC", element: "OWNERSHIP", patterns: [/\bcipc\b/i, /\bcor\s*14\.3\b/i, /\bcor\s*39\b/i, /disclosure certificate/i, /registration certificate/i] },
  { documentClass: "SHARE_REGISTER", element: "OWNERSHIP", patterns: [/share(holder)?s?[\s_-]*register/i, /securities register/i] },
  { documentClass: "SHARE_CERTIFICATE", element: "OWNERSHIP", patterns: [/share[\s_-]*cert/i] },
  { documentClass: "SHAREHOLDER_AGREEMENT", element: "OWNERSHIP", patterns: [/shareholders?[\s_-]*agreement/i, /\bsha\b/i] },
  { documentClass: "MOI", element: "OWNERSHIP", patterns: [/\bmoi\b/i, /memorandum of incorporation/i] },
  { documentClass: "TRUST_DEED", element: "OWNERSHIP", patterns: [/trust[\s_-]*deed/i, /letters? of authority/i] },
  { documentClass: "BENEFICIARY_DOCUMENTATION", element: "OWNERSHIP", patterns: [/beneficiar(y|ies)[\s_-]*(list|register|schedule)/i] },
  { documentClass: "SUPPLIER_CERTIFICATE", element: "PREFERENTIAL_PROCUREMENT", patterns: [/(supplier|vendor).*(cert|bbbee|b-bbee)/i, /b-?bbee[\s_-]*cert/i, /verification[\s_-]*cert/i] },
  { documentClass: "AFFIDAVIT", element: null, patterns: [/affidavit/i, /sworn[\s_-]*statement/i] },
  { documentClass: "SUPPLIER_LISTING", element: "PREFERENTIAL_PROCUREMENT", patterns: [/(supplier|vendor|creditor)s?[\s_-]*(list|listing|analysis|spend|master)/i, /procurement[\s_-]*(spend|schedule|analysis)/i, /\btmps\b/i] },
  { documentClass: "SUPPLIER_DEVELOPMENT", element: "SUPPLIER_DEVELOPMENT", patterns: [/supplier[\s_-]*dev/i, /\bsd[\s_-]*(contribution|agreement|schedule)/i] },
  { documentClass: "ENTERPRISE_DEVELOPMENT", element: "ENTERPRISE_DEVELOPMENT", patterns: [/enterprise[\s_-]*dev/i, /\bed[\s_-]*(contribution|agreement|schedule)/i] },
  { documentClass: "SED_DOCUMENTATION", element: "SOCIO_ECONOMIC_DEVELOPMENT", patterns: [/\bsed\b/i, /socio[\s_-]*economic/i, /donation/i, /\bcsi\b/i, /\bnpo\b|\bnpc\b/i] },
  { documentClass: "WSP", element: "SKILLS_DEVELOPMENT", patterns: [/\bwsp\b/i, /workplace[\s_-]*skills[\s_-]*plan/i] },
  { documentClass: "ATR", element: "SKILLS_DEVELOPMENT", patterns: [/\batr\b/i, /annual[\s_-]*training[\s_-]*report/i] },
  { documentClass: "LEARNERSHIP_AGREEMENT", element: "SKILLS_DEVELOPMENT", patterns: [/learnership/i, /internship[\s_-]*agreement/i, /apprenticeship/i] },
  { documentClass: "BURSARY_AGREEMENT", element: "SKILLS_DEVELOPMENT", patterns: [/bursary/i] },
  { documentClass: "TRAINING_INVOICE", element: "SKILLS_DEVELOPMENT", patterns: [/training[\s_-]*(invoice|inv)/i, /(invoice|inv).*training/i] },
  { documentClass: "PAYROLL", element: "SKILLS_DEVELOPMENT", patterns: [/payroll/i, /pay[\s_-]*register/i, /\bemp\s*201\b/i, /\birp\s*5\b/i, /salar(y|ies)/i] },
  { documentClass: "EMPLOYEE_LISTING", element: "MANAGEMENT_CONTROL", patterns: [/employee[\s_-]*(list|listing|schedule|register)/i, /staff[\s_-]*list/i, /headcount/i] },
  { documentClass: "ORGANOGRAM", element: "MANAGEMENT_CONTROL", patterns: [/organogram/i, /org[\s_-]*chart/i, /organi[sz]ational[\s_-]*structure/i] },
  { documentClass: "FINANCIAL_STATEMENTS", element: "GENERAL", patterns: [/(annual|audited)[\s_-]*financial/i, /\bafs\b/i, /financial[\s_-]*statements?/i] },
  { documentClass: "MANAGEMENT_ACCOUNTS", element: "GENERAL", patterns: [/management[\s_-]*accounts?/i, /mgmt[\s_-]*accounts?/i] },
  { documentClass: "TRIAL_BALANCE", element: "GENERAL", patterns: [/trial[\s_-]*balance/i, /\btb\b/i] },
  { documentClass: "GENERAL_LEDGER", element: "GENERAL", patterns: [/general[\s_-]*ledger/i, /\bgl\b/i, /ledger/i] },
  { documentClass: "BANK_STATEMENT", element: null, patterns: [/bank[\s_-]*statement/i, /statement[\s_-]*of[\s_-]*account/i] },
  { documentClass: "PROOF_OF_PAYMENT", element: null, patterns: [/proof[\s_-]*of[\s_-]*payment/i, /\bpop\b/i, /remittance/i, /payment[\s_-]*confirmation/i] },
  { documentClass: "CONFIRMATION_LETTER", element: null, patterns: [/confirmation[\s_-]*letter/i, /letter[\s_-]*of[\s_-]*confirmation/i, /beneficiary[\s_-]*letter/i] },
  { documentClass: "INVOICE", element: null, patterns: [/invoice/i, /\binv[\s_-]?\d/i, /tax[\s_-]*invoice/i] },
];

export interface HeuristicClassification {
  documentClass: DocumentClass;
  element: ScorecardElementCode | null;
  matchedOn: string | null;
  confidence: "LOW" | "UNVERIFIED";
}

export function classifyByHeuristic(filename: string, textSample?: string): HeuristicClassification {
  const stem = filename.replace(/\.[A-Za-z0-9]+$/, "").replace(/[_]+/g, " ");
  for (const source of [stem, textSample?.slice(0, 4000) ?? ""]) {
    if (!source) continue;
    for (const rule of RULES) {
      const hit = rule.patterns.find((p) => p.test(source));
      if (hit) return { documentClass: rule.documentClass, element: rule.element, matchedOn: hit.source, confidence: "LOW" };
    }
  }
  return { documentClass: "UNKNOWN", element: null, matchedOn: null, confidence: "UNVERIFIED" };
}
