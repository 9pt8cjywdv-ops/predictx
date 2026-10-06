import { z } from "zod";

/**
 * Agent I/O contracts (spec §48). Every agent returns JSON validated against one
 * of these schemas before anything is stored. Money/percentages are numbers in
 * agent output but are converted to Decimal before reaching the engine.
 *
 * Schemas deliberately avoid constructs unsupported by structured outputs
 * (regex, numeric bounds); those invariants are enforced in postValidate().
 */

export const ConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW", "UNVERIFIED"]);
export const EvidenceStatusSchema = z.enum([
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "INSUFFICIENT",
  "INVALID",
  "OUTSIDE_PERIOD",
  "DUPLICATE",
  "CONFLICTING",
  "REVIEW_REQUIRED",
]);
export const ElementSchema = z.enum([
  "OWNERSHIP",
  "MANAGEMENT_CONTROL",
  "SKILLS_DEVELOPMENT",
  "PREFERENTIAL_PROCUREMENT",
  "SUPPLIER_DEVELOPMENT",
  "ENTERPRISE_DEVELOPMENT",
  "SOCIO_ECONOMIC_DEVELOPMENT",
  "SECTOR_SPECIFIC",
  "GENERAL",
]);
export const DocumentClassSchema = z.enum([
  "CIPC", "FINANCIAL_STATEMENTS", "MANAGEMENT_ACCOUNTS", "TRIAL_BALANCE", "GENERAL_LEDGER", "PAYROLL",
  "EMPLOYEE_LISTING", "EEA2", "EEA4", "ORGANOGRAM", "WSP", "ATR", "TRAINING_INVOICE", "PROOF_OF_PAYMENT",
  "LEARNERSHIP_AGREEMENT", "BURSARY_AGREEMENT", "SUPPLIER_LISTING", "SUPPLIER_CERTIFICATE", "AFFIDAVIT",
  "SHARE_CERTIFICATE", "SHARE_REGISTER", "SHAREHOLDER_AGREEMENT", "MOI", "TRUST_DEED",
  "BENEFICIARY_DOCUMENTATION", "ENTERPRISE_DEVELOPMENT", "SUPPLIER_DEVELOPMENT", "SED_DOCUMENTATION",
  "BANK_STATEMENT", "INVOICE", "CONFIRMATION_LETTER", "UNKNOWN",
]);

/** Generic finding shape shared by all specialist agents (spec §48 example). */
export const FindingSchema = z.object({
  findingType: z.string(),
  element: ElementSchema,
  indicator: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  claimedValue: z.number().nullable(),
  verifiedValue: z.number().nullable(),
  evidenceIds: z.array(z.string()),
  regulatoryProvisionIds: z.array(z.string()),
  confidence: ConfidenceSchema,
  issues: z.array(z.string()),
  isVerificationRisk: z.boolean(),
  requiresHumanReview: z.boolean(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** Signals the model noticed instructions embedded in a document. */
export const InjectionReportSchema = z.object({
  documentId: z.string(),
  excerpt: z.string(),
});

// ---- DOCUMENT_EVIDENCE_AGENT ------------------------------------------------

export const ExtractedDataPointSchema = z.object({
  dataKey: z.string(),
  label: z.string(),
  originalValue: z.string(),
  normalisedValue: z.string(),
  unit: z.enum(["ZAR", "PERCENT", "DATE", "COUNT", "TEXT", "BOOLEAN"]),
  location: z.object({
    page: z.number().nullable(),
    sheet: z.string().nullable(),
    row: z.number().nullable(),
    column: z.string().nullable(),
    textSpan: z.string().nullable(),
  }),
  element: ElementSchema.nullable(),
  confidence: ConfidenceSchema,
});

export const DocumentEvidenceOutputSchema = z.object({
  documents: z.array(
    z.object({
      documentId: z.string(),
      documentClass: DocumentClassSchema,
      classificationConfidence: ConfidenceSchema,
      relevantElements: z.array(ElementSchema),
      entityNameOnDocument: z.string().nullable(),
      documentDate: z.string().nullable(),
      periodCovered: z.object({ start: z.string().nullable(), end: z.string().nullable() }),
      signed: z.enum(["YES", "NO", "NOT_APPLICABLE", "CANNOT_DETERMINE"]),
      evidenceStatus: EvidenceStatusSchema,
      dataPoints: z.array(ExtractedDataPointSchema),
      anomalies: z.array(z.string()),
    }),
  ),
  contradictions: z.array(z.object({ description: z.string(), documentIds: z.array(z.string()) })),
  suspectedInjection: z.array(InjectionReportSchema),
});
export type DocumentEvidenceOutput = z.infer<typeof DocumentEvidenceOutputSchema>;

// ---- CODE_APPLICABILITY_AGENT -----------------------------------------------

export const InterpretationSchema = z.object({
  frameworkCode: z.string(),
  regulatoryVersionId: z.string().nullable(),
  entityClassification: z.enum(["EME", "QSE", "GENERIC", "UNDETERMINED"]),
  rationale: z.string(),
  evidenceIds: z.array(z.string()),
  regulatoryProvisionIds: z.array(z.string()),
  confidence: ConfidenceSchema,
});

export const CodeApplicabilityOutputSchema = z.object({
  primary: InterpretationSchema,
  /** Spec §15: if uncertain, return competing interpretations. */
  alternatives: z.array(InterpretationSchema),
  revenueStreams: z.array(z.object({ description: z.string(), amount: z.number().nullable(), evidenceIds: z.array(z.string()) })),
  turnoverEvidence: z.object({ amount: z.number().nullable(), evidenceIds: z.array(z.string()) }),
  requiresHumanReview: z.boolean(),
  openQuestions: z.array(z.string()),
  suspectedInjection: z.array(InjectionReportSchema),
});
export type CodeApplicabilityOutput = z.infer<typeof CodeApplicabilityOutputSchema>;

// ---- Specialist element agents (Phase 4) -----------------------------------

export const ElementAgentOutputSchema = z.object({
  element: ElementSchema,
  findings: z.array(FindingSchema),
  /** Structured inputs proposed for the deterministic engine; never points. */
  proposedInputs: z.array(
    z.object({
      indicatorCode: z.string(),
      inputKey: z.string(),
      unit: z.enum(["ZAR", "PERCENT", "COUNT", "BOOLEAN", "RATIO"]),
      clientClaim: z.number().nullable(),
      verifiedValue: z.number().nullable(),
      evidenceIds: z.array(z.string()),
      confidence: ConfidenceSchema,
    }),
  ),
  outstandingEvidence: z.array(z.object({ description: z.string(), reason: z.string(), priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]) })),
  suspectedInjection: z.array(InjectionReportSchema),
});
export type ElementAgentOutput = z.infer<typeof ElementAgentOutputSchema>;

export const AGENT_PROMPT_VERSION = "2026-10-06.1";
