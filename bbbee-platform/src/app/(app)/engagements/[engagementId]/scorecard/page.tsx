import { notFound } from "next/navigation";
import { Button, Card, DL, EmptyState, ErrorBanner, Notice, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { CalculationTrace, PriorityElementResult } from "@/lib/engine";
import { formatDateTime, humanize } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { getScopedEngagement } from "@/lib/tenancy";
import { runScorecardAction } from "../actions";

export default async function ScorecardPage({ params, searchParams }: { params: Promise<{ engagementId: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  if (user.role === "CLIENT_USER") notFound();
  const { engagementId } = await params;
  const { error } = await searchParams;
  await getScopedEngagement(user, engagementId);
  const canRun = await can(user, Permission.CALCULATION_RUN);

  const scorecard = await prisma.scorecard.findFirst({
    where: { engagementId, isScenario: false },
    orderBy: { createdAt: "desc" },
    include: {
      summary: true,
      template: { include: { elements: { orderBy: { sortOrder: "asc" } } } },
      results: { include: { calculationRule: { include: { indicator: true, provisions: { include: { provision: { include: { document: true } } } } } } } },
    },
  });

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      <div className="flex items-center justify-between">
        <Notice tone="amber" title="PROVISIONAL VERIFIED SCORE — VERIFICATION MANAGER REVIEW REQUIRED">
          Points are produced by the deterministic calculation engine from verified inputs and versioned rules. Claude never determines scores.
        </Notice>
        {canRun && (
          <form action={runScorecardAction.bind(null, engagementId)}>
            <Button type="submit">Recalculate</Button>
          </form>
        )}
      </div>
      {!scorecard ? (
        <EmptyState title="No scorecard calculated">Confirm the regulatory version and scorecard template, then calculate.</EmptyState>
      ) : (
        <>
          <Card title={`${scorecard.template.name} · ${humanize(scorecard.kind)} · ${formatDateTime(scorecard.createdAt)}`} padded={false}>
            <Table>
              <thead>
                <tr><Th>Element</Th><Th>Indicator</Th><Th>Target</Th><Th>Weighting</Th><Th>Verified achievement</Th><Th className="text-right">Points</Th><Th className="text-right">Bonus</Th><Th>Confidence</Th><Th>Status</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scorecard.template.elements.map((el) => {
                  const rows = scorecard.results.filter((r) => r.calculationRule.indicator.elementId === el.id);
                  return rows.map((r, i) => {
                    const t = r.trace as unknown as CalculationTrace;
                    return (
                      <tr key={r.id} className="align-top">
                        <Td className="font-medium">{i === 0 ? el.name : ""}</Td>
                        <Td>
                          <details>
                            <summary className="cursor-pointer text-brand-700">{r.indicatorCode}</summary>
                            <div className="mt-2 w-[32rem] space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                              <DL items={[["Formula", t.formula || "—"], ["Raw → capped", `${t.rawPoints ?? "—"} → ${t.cappedPoints ?? "—"}`], ["Rounding", t.roundingMethod], ["Engine", `${r.engineVersion}`]]} />
                              <div>
                                <div className="label">Inputs (verified vs claimed)</div>
                                {t.inputs.length === 0 ? "None" : t.inputs.map((inp) => (
                                  <div key={inp.key} className="font-mono">{inp.key}: {inp.verifiedValue ?? "—"} (claimed {inp.clientClaim ?? "—"}) · evidence {inp.evidenceIds.length}</div>
                                ))}
                              </div>
                              <div>
                                <div className="label">Regulatory provisions</div>
                                {r.calculationRule.provisions.length === 0 ? <span className="text-red-700">None linked — REGULATORY SOURCE REQUIRES HUMAN CONFIRMATION</span> : r.calculationRule.provisions.map(({ provision: p }) => <div key={p.id}>{p.reference} — {p.document.title}</div>)}
                              </div>
                              <div><div className="label">Notes</div>{t.notes.map((n, k) => <div key={k}>{n}</div>)}</div>
                            </div>
                          </details>
                        </Td>
                        <Td className="num">{t.target ?? "—"}</Td>
                        <Td className="num">{t.weighting ?? "—"}</Td>
                        <Td className="num">{t.actual ?? "—"}</Td>
                        <Td className="num text-right font-medium">{r.points?.toString() ?? "—"}</Td>
                        <Td className="num text-right">{r.bonusPoints?.toString() ?? "—"}</Td>
                        <Td><StatusBadge status={r.confidence} /></Td>
                        <Td><StatusBadge status={r.status} /></Td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </Table>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Result">
              <DL items={[["Total points", scorecard.summary?.totalPoints?.toString() ?? "Incomplete — blocked indicators"], ["Level before discount", scorecard.summary?.levelBeforeDiscount], ["Level after discount", scorecard.summary?.levelAfterDiscount], ["Procurement recognition", scorecard.summary?.recognitionPercent?.toString()], ["Label", scorecard.summary?.resultLabel]]} />
            </Card>
            <Card title="Priority elements">
              {((scorecard.summary?.priorityResults ?? []) as unknown as PriorityElementResult[]).length === 0 ? (
                <p className="text-sm text-slate-500">No priority elements configured for this template (REGULATORY_CONFIGURATION_REQUIRED).</p>
              ) : (
                ((scorecard.summary?.priorityResults ?? []) as unknown as PriorityElementResult[]).map((p) => (
                  <div key={p.element} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
                    <span>{humanize(p.element)}</span><StatusBadge status={p.outcome} />
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
