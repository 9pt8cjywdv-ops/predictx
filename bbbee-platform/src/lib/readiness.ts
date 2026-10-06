import { prisma } from "./db";

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}

/** Spec §62: gate before an engagement may move to Technical Review. */
export async function verificationManagerChecklist(engagementId: string): Promise<ChecklistItem[]> {
  const [eng, unclassified, totalDocs, openQueries, scorecard, openRisks] = await Promise.all([
    prisma.verificationEngagement.findUniqueOrThrow({ where: { id: engagementId } }),
    prisma.document.count({ where: { engagementId, deletedAt: null, documentClass: "UNKNOWN", status: { not: "DUPLICATE" }, versions: { none: { detectedType: "zip" } } } }),
    prisma.document.count({ where: { engagementId, deletedAt: null } }),
    prisma.verificationQuery.count({ where: { engagementId, status: { in: ["OPEN", "CLIENT_RESPONDED", "UNDER_REVIEW"] } } }),
    prisma.scorecard.findFirst({ where: { engagementId, isScenario: false }, orderBy: { createdAt: "desc" }, include: { summary: true, results: true } }),
    prisma.verificationFinding.count({ where: { engagementId, isVerificationRisk: true, status: "OPEN" } }),
  ]);
  const priority = (scorecard?.summary?.priorityResults ?? []) as Array<{ outcome: string }>;
  const allCalculated = !!scorecard && scorecard.results.length > 0 && scorecard.results.every((r) => r.status === "CALCULATED");
  return [
    { key: "classified", label: "All material evidence classified", done: totalDocs > 0 && unclassified === 0, detail: totalDocs === 0 ? "No documents uploaded" : `${unclassified} unclassified document(s)` },
    { key: "queries", label: "All unresolved queries acknowledged", done: openQueries === 0, detail: `${openQueries} open query(ies)` },
    { key: "scorecard", label: "Scorecard calculated", done: allCalculated, detail: scorecard ? (allCalculated ? "All indicators calculated" : "Indicators blocked or incomplete") : "Not yet calculated" },
    {
      key: "priority",
      label: "Priority elements tested",
      done: allCalculated && priority.every((p) => ["PASS", "FAIL", "NOT_APPLICABLE"].includes(p.outcome)),
      detail: priority.length ? priority.map((p) => p.outcome).join(", ") : "No priority results",
    },
    { key: "framework", label: "Regulatory framework confirmed", done: !!eng.regulatoryVersionId && !!eng.regulatoryConfirmedAt, detail: eng.regulatoryVersionId ? "Confirmed" : "Not confirmed" },
    { key: "exceptions", label: "Exceptions reviewed", done: openRisks === 0, detail: `${openRisks} open verification risk(s)` },
  ];
}
