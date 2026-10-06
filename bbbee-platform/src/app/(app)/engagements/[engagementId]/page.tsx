import { Card, DL, Notice, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate, formatZar, humanize } from "@/lib/format";
import { verificationManagerChecklist } from "@/lib/readiness";
import { getScopedEngagement } from "@/lib/tenancy";

export default async function EngagementOverview({ params }: { params: Promise<{ engagementId: string }> }) {
  const user = await requireUser();
  const { engagementId } = await params;
  const e = await getScopedEngagement(user, engagementId);
  const isClient = user.role === "CLIENT_USER";

  const [byClass, staff, checklist, latest] = await Promise.all([
    prisma.document.groupBy({ by: ["documentClass"], where: { engagementId, deletedAt: null }, _count: true }),
    prisma.verificationEngagement.findUniqueOrThrow({ where: { id: engagementId }, select: { manager: { select: { name: true } }, analyst: { select: { name: true } }, signatory: { select: { name: true } } } }),
    isClient ? Promise.resolve([]) : verificationManagerChecklist(engagementId),
    isClient ? Promise.resolve(null) : prisma.scorecard.findFirst({ where: { engagementId, isScenario: false }, orderBy: { createdAt: "desc" }, include: { summary: true } }),
  ]);
  const period = e.measurementPeriods.find((p) => p.isPrimary) ?? e.measurementPeriods[0];

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Notice tone="blue" title="Provisional assessment — not a B-BBEE certificate">
          Results in this workspace are AI-ASSISTED VERIFICATION RESULTS. VERIFICATION MANAGER REVIEW REQUIRED and TECHNICAL SIGN-OFF REQUIRED before any certificate is issued through the agency&apos;s accredited process.
        </Notice>
        <Card title="Engagement">
          <DL
            items={[
              ["Client", e.client.name],
              ["Measured entity", e.measuredEntity.legalName],
              ["Registration no.", e.measuredEntity.registrationNumber],
              ["Measurement period", period ? `${formatDate(period.startDate)} → ${formatDate(period.endDate)}` : null],
              ["Financial year end", period ? formatDate(period.financialYearEnd) : null],
              ["Entity classification", <StatusBadge key="c" status={e.entityClassification} />],
              ["Verified turnover", e.verifiedTurnover ? formatZar(e.verifiedTurnover.toString()) : null],
              ["Regulatory version", e.regulatoryVersion ? `${e.regulatoryVersion.framework.name} — ${e.regulatoryVersion.label}` : null],
              ["Verification manager", staff.manager?.name],
              ["Analyst", staff.analyst?.name],
              ["Technical signatory", staff.signatory?.name],
              ["Prior certificate expiry", formatDate(e.previousCertificateExpiry)],
            ]}
          />
        </Card>
        <Card title="Evidence inventory" padded={false}>
          <Table>
            <thead><tr><Th>Document class</Th><Th className="text-right">Documents</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {byClass.length === 0 && <tr><Td colSpan={2} className="text-slate-500">No documents uploaded yet.</Td></tr>}
              {byClass.sort((a, b) => b._count - a._count).map((r) => (
                <tr key={r.documentClass}><Td>{humanize(r.documentClass)}</Td><Td className="num text-right">{r._count}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      {!isClient && (
        <div className="space-y-6">
          <Card title="Ready for technical review?">
            <ul className="space-y-2.5">
              {checklist.map((c) => (
                <li key={c.key} className="flex gap-2.5 text-sm">
                  <span aria-hidden className={c.done ? "text-emerald-600" : "text-slate-300"}>{c.done ? "●" : "○"}</span>
                  <div>
                    <div className={c.done ? "text-slate-800" : "text-slate-600"}>{c.label}</div>
                    <div className="text-xs text-slate-500">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Provisional score">
            {latest?.summary ? (
              <DL items={[["Total points", latest.summary.totalPoints?.toString() ?? "Incomplete"], ["Level (after discount)", latest.summary.levelAfterDiscount], ["Calculated", formatDate(latest.createdAt)]]} />
            ) : (
              <p className="text-sm text-slate-500">Not yet calculated.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
