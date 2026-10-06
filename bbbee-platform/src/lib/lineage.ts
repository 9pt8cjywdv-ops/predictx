import type { CalculationTrace } from "./engine";
import { prisma } from "./db";

/**
 * Spec §65: every score must trace both
 *   SCORE → FORMULA → VERIFIED INPUT → EVIDENCE → ORIGINAL DOCUMENT
 *   SCORE → CALCULATION RULE → REGULATORY PROVISION → CODE VERSION
 * This resolves both chains for a CalculationResult and reports each break.
 */
export interface LineageReport {
  calculationResultId: string;
  points: string | null;
  formula: string;
  evidenceChain: Array<{
    inputKey: string;
    verifiedValue: string | null;
    calculationInputId: string | null;
    evidence: Array<{
      evidenceId: string;
      label: string;
      originalValue: string;
      sourceLocation: unknown;
      confidence: string;
      reviewStatus: string;
      confirmedBy: string | null;
      confirmedAt: Date | null;
      document: { documentId: string; title: string; versionId: string; filename: string; sha256: string } | null;
    }>;
  }>;
  regulatoryChain: {
    ruleId: string;
    indicatorCode: string;
    configurationStatus: string;
    regulatoryVersion: { id: string; label: string; status: string; validFrom: Date | null; validTo: Date | null; framework: string };
    provisions: Array<{ id: string; reference: string; heading: string | null; document: string; gazetteNumber: string | null }>;
  };
  breaks: string[];
  auditable: boolean;
}

export async function traceCalculationResult(calculationResultId: string, engagementId: string): Promise<LineageReport> {
  const result = await prisma.calculationResult.findFirstOrThrow({
    where: { id: calculationResultId, engagementId },
    include: {
      calculationRule: {
        include: {
          regulatoryVersion: { include: { framework: true } },
          provisions: { include: { provision: { include: { document: true } } } },
        },
      },
    },
  });
  const trace = result.trace as unknown as CalculationTrace;
  const breaks: string[] = [];

  const evidenceIds = trace.inputs.flatMap((i) => i.evidenceIds);
  const evidence = await prisma.evidenceItem.findMany({
    where: { id: { in: evidenceIds }, engagementId },
    include: { documentVersion: { include: { document: true } }, confirmedBy: { select: { name: true } } },
  });
  const evById = new Map(evidence.map((e) => [e.id, e]));

  const evidenceChain = trace.inputs.map((input) => {
    if (input.verifiedValue != null && input.evidenceIds.length === 0) breaks.push(`Input ${input.key} has a verified value but no linked evidence.`);
    return {
      inputKey: input.key,
      verifiedValue: input.verifiedValue,
      calculationInputId: input.calculationInputId ?? null,
      evidence: input.evidenceIds.map((id) => {
        const e = evById.get(id);
        if (!e) {
          breaks.push(`Evidence ${id} (input ${input.key}) not found.`);
          return { evidenceId: id, label: "MISSING", originalValue: "", sourceLocation: null, confidence: "UNVERIFIED", reviewStatus: "UNREVIEWED", confirmedBy: null, confirmedAt: null, document: null };
        }
        if (e.reviewStatus !== "CONFIRMED" && e.reviewStatus !== "OVERRIDDEN") breaks.push(`Evidence ${id} has not been confirmed by a reviewer.`);
        return {
          evidenceId: e.id,
          label: e.label,
          originalValue: e.originalValue,
          sourceLocation: e.sourceLocation,
          confidence: e.confidence,
          reviewStatus: e.reviewStatus,
          confirmedBy: e.confirmedBy?.name ?? null,
          confirmedAt: e.confirmedAt,
          document: {
            documentId: e.documentVersion.documentId,
            title: e.documentVersion.document.title,
            versionId: e.documentVersionId,
            filename: e.documentVersion.originalFilename,
            sha256: e.documentVersion.sha256,
          },
        };
      }),
    };
  });

  const rule = result.calculationRule;
  if (rule.configurationStatus !== "CONFIGURED") breaks.push("Calculation rule is REGULATORY_CONFIGURATION_REQUIRED.");
  if (rule.provisions.length === 0) breaks.push("Calculation rule is not linked to any regulatory provision.");
  if (!["PUBLISHED", "SUPERSEDED"].includes(rule.regulatoryVersion.status)) breaks.push(`Regulatory version is ${rule.regulatoryVersion.status}, not in force.`);

  return {
    calculationResultId: result.id,
    points: result.points?.toString() ?? null,
    formula: trace.formula,
    evidenceChain,
    regulatoryChain: {
      ruleId: rule.id,
      indicatorCode: rule.indicatorCode,
      configurationStatus: rule.configurationStatus,
      regulatoryVersion: {
        id: rule.regulatoryVersion.id,
        label: rule.regulatoryVersion.label,
        status: rule.regulatoryVersion.status,
        validFrom: rule.regulatoryVersion.validFrom,
        validTo: rule.regulatoryVersion.validTo,
        framework: rule.regulatoryVersion.framework.name,
      },
      provisions: rule.provisions.map(({ provision: p }) => ({
        id: p.id,
        reference: p.reference,
        heading: p.heading,
        document: p.document.title,
        gazetteNumber: p.document.gazetteNumber,
      })),
    },
    breaks,
    auditable: breaks.length === 0,
  };
}
