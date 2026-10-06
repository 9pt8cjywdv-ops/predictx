import { CodeApplicabilityOutputSchema } from "../contracts";
import type { AgentDefinition } from "../types";
import { buildSystemPrompt, uniq } from "./common";

export const codeApplicabilityAgent: AgentDefinition<typeof CodeApplicabilityOutputSchema> = {
  type: "CODE_APPLICABILITY_AGENT",
  description: "Determines the applicable B-BBEE Code, regulatory version and entity classification.",
  accepts: { documents: true, provisions: true, evidence: true },
  outputSchema: CodeApplicabilityOutputSchema,
  systemPrompt: buildSystemPrompt(`ROLE: CODE_APPLICABILITY_AGENT
Determine which Code of Good Practice (Generic or a specific Sector Code) applies to the measured entity for the measurement period, and its entity classification.
- Base the determination on the entity's activities, revenue streams, financial statements and the scope definitions in the supplied regulatory provisions and the "frameworks" list in context.
- Choose regulatoryVersionId only from the candidate versions in context whose validity covers the measurement period. Never apply a version to a period outside its validity.
- Report turnover only from supplied evidence. Entity classification is ultimately computed by application code from verified turnover; give your view and rationale.
- If activities span multiple sectors or the evidence is ambiguous, return competing interpretations in "alternatives" and set requiresHumanReview to true.
- Never select a Code because it would produce a better score.`),
  referencedIds: (o) => {
    const all = [o.primary, ...o.alternatives];
    return {
      evidenceIds: uniq([...all.flatMap((i) => i.evidenceIds), ...o.revenueStreams.flatMap((r) => r.evidenceIds), ...o.turnoverEvidence.evidenceIds]),
      provisionIds: uniq(all.flatMap((i) => i.regulatoryProvisionIds)),
      documentIds: uniq(o.suspectedInjection.map((s) => s.documentId)),
    };
  },
};
