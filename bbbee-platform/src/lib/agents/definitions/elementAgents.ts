import type { AgentType } from "@prisma/client";
import { ElementAgentOutputSchema } from "../contracts";
import type { AgentDefinition } from "../types";
import { buildSystemPrompt, uniq } from "./common";

const ELEMENT_BRIEFS: Array<{ type: AgentType; brief: string }> = [
  {
    type: "OWNERSHIP_AGENT",
    brief: `ROLE: OWNERSHIP_AGENT
Analyse share registers, share certificates, MOI, shareholder agreements, trust deeds, beneficiary records and corporate shareholder structures.
Trace ownership through every tier supplied. For each participant determine voting rights, economic interest, acquisition debt, restrictions, options and dividend flows from evidence only.
Race and gender of participants must come from documentary evidence (e.g. certified ID-linked declarations), never from names.
Propose structured inputs (fractions as decimals, e.g. 0.255) for the ownership indicators; do not calculate points.`,
  },
  {
    type: "MANAGEMENT_CONTROL_AGENT",
    brief: `ROLE: MANAGEMENT_CONTROL_AGENT
Analyse employee listings, payroll, organograms, contracts, EEA2/EEA4 and board records.
Determine headcounts by occupational level (Board, Executive, Senior, Middle, Junior management) and by evidenced race, gender and disability status.
Reconcile EEA submissions against payroll and the employee listing and report discrepancies. EAP targets are applied by application code.`,
  },
  {
    type: "SKILLS_AGENT",
    brief: `ROLE: SKILLS_AGENT
Analyse payroll (Leviable Amount), training records, invoices, proofs of payment, WSP/ATR, SETA records, learnership, internship and bursary agreements.
Expenditure is eligible only with the full chain: invoice, proof of payment, attendance or agreement, and evidenced learner status. An invoice alone is INSUFFICIENT.
Detect duplicate invoices, duplicate learners and spend outside the measurement period.`,
  },
  {
    type: "PROCUREMENT_AGENT",
    brief: `ROLE: PROCUREMENT_AGENT
Build a supplier master by reconciling the supplier listing to the general ledger / trial balance.
For each supplier record spend, certificate or affidavit, issuing agency, validity dates, B-BBEE level, black and black-women ownership, and supplier category.
Flag expired certificates, certificates in another entity's name, unsigned or uncommissioned affidavits, duplicates and potential exclusions. Recognition percentages are applied by application code.`,
  },
  {
    type: "ESD_AGENT",
    brief: `ROLE: ESD_AGENT
Analyse Supplier Development and Enterprise Development separately.
For each contribution identify beneficiary, eligibility evidence (ownership, turnover, supplier status), contribution type, amount, date, agreement, proof of payment and beneficiary confirmation.
Recognition factors are applied by application code; propose verified contribution amounts only where the evidence chain is complete.`,
  },
  {
    type: "SED_AGENT",
    brief: `ROLE: SED_AGENT
Analyse socio-economic development contributions: beneficiary organisation, ultimate beneficiaries, evidenced fraction of qualifying beneficiaries, contribution, payment, purpose and supporting documents.
A donation to an NPC/NPO does not automatically qualify in full; propose the evidenced qualifying fraction separately from the amount.`,
  },
];

function makeElementAgent(type: AgentType, brief: string): AgentDefinition<typeof ElementAgentOutputSchema> {
  return {
    type,
    description: brief.split("\n")[1] ?? brief,
    accepts: { documents: true, provisions: true, evidence: true },
    outputSchema: ElementAgentOutputSchema,
    systemPrompt: buildSystemPrompt(
      `${brief}\nReturn findings, proposed engine inputs (verified and claimed values kept separate), and outstanding evidence needed to resolve gaps.`,
    ),
    referencedIds: (o) => ({
      evidenceIds: uniq([...o.findings.flatMap((f) => f.evidenceIds), ...o.proposedInputs.flatMap((p) => p.evidenceIds)]),
      provisionIds: uniq(o.findings.flatMap((f) => f.regulatoryProvisionIds)),
      documentIds: uniq(o.suspectedInjection.map((s) => s.documentId)),
    }),
  };
}

export const elementAgents = Object.fromEntries(ELEMENT_BRIEFS.map((b) => [b.type, makeElementAgent(b.type, b.brief)])) as Record<
  "OWNERSHIP_AGENT" | "MANAGEMENT_CONTROL_AGENT" | "SKILLS_AGENT" | "PROCUREMENT_AGENT" | "ESD_AGENT" | "SED_AGENT",
  AgentDefinition<typeof ElementAgentOutputSchema>
>;
