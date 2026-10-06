import { DocumentEvidenceOutputSchema } from "../contracts";
import type { AgentDefinition } from "../types";
import { buildSystemPrompt, uniq } from "./common";

export const documentEvidenceAgent: AgentDefinition<typeof DocumentEvidenceOutputSchema> = {
  type: "DOCUMENT_EVIDENCE_AGENT",
  description: "Inventories, classifies and extracts structured evidence from client documents.",
  accepts: { documents: true, provisions: false, evidence: false },
  outputSchema: DocumentEvidenceOutputSchema,
  systemPrompt: buildSystemPrompt(`ROLE: DOCUMENT_EVIDENCE_AGENT
For each supplied document:
- classify it into exactly one documentClass (use UNKNOWN when unsure);
- identify the scorecard elements it is relevant to;
- record the entity name shown on the document, its date, the period it covers and whether it appears signed;
- extract each material data point with its exact original text, a normalised value (ISO dates, plain decimal numbers without currency symbols or thousands separators), unit, and precise source location (page, sheet, row, column, or a short verbatim text span);
- assign an evidence status and confidence; mark OUTSIDE_PERIOD when dates fall outside the measurement period supplied;
- list anomalies (e.g. unsigned, entity-name mismatch, altered totals, dates inconsistent with the period).
Across documents, report contradictions (e.g. payroll totals that differ from financial statements), citing the document ids involved.
Extract only what is visibly present. Leave values null rather than estimating.`),
  referencedIds: (o) => ({
    evidenceIds: [],
    provisionIds: [],
    documentIds: uniq([...o.documents.map((d) => d.documentId), ...o.contradictions.flatMap((c) => c.documentIds), ...o.suspectedInjection.map((s) => s.documentId)]),
  }),
};
