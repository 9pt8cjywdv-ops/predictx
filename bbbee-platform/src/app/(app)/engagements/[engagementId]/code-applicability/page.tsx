import { notFound } from "next/navigation";
import { Button, Card, DL, ErrorBanner, Notice, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { classifyEntity, CONFIGURED, type ClassificationThresholds } from "@/lib/engine";
import { formatDate } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { selectVersionForDate } from "@/lib/regulatory/versions";
import { getScopedEngagement } from "@/lib/tenancy";
import { confirmVersionAction, selectTemplateAction } from "../actions";

export default async function CodeApplicabilityPage({ params, searchParams }: { params: Promise<{ engagementId: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  if (user.role === "CLIENT_USER") notFound();
  const { engagementId } = await params;
  const { error } = await searchParams;
  const e = await getScopedEngagement(user, engagementId);
  const period = e.measurementPeriods.find((p) => p.isPrimary) ?? e.measurementPeriods[0];
  const canManage = await can(user, Permission.ENGAGEMENT_MANAGE);

  const frameworks = await prisma.regulatoryFramework.findMany({
    include: { versions: { orderBy: { validFrom: "desc" }, include: { scorecardTemplates: true, classificationRules: true } }, sectorCode: true },
    orderBy: { name: "asc" },
  });

  const candidates = frameworks.map((f) => {
    let applicable = null;
    let conflict: string | null = null;
    try {
      applicable = period ? selectVersionForDate(f.versions, period.endDate) : null;
    } catch (err) {
      conflict = (err as Error).message;
    }
    return { framework: f, applicable, conflict };
  });

  const confirmed = e.regulatoryVersionId ? await prisma.regulatoryVersion.findUnique({ where: { id: e.regulatoryVersionId }, include: { scorecardTemplates: true, classificationRules: true } }) : null;
  const rule = confirmed?.classificationRules.find((r) => r.sectorCode === null) ?? confirmed?.classificationRules[0];
  const classification = rule
    ? classifyEntity(e.verifiedTurnover?.toString() ?? null, {
        ...(rule.thresholds as Partial<ClassificationThresholds>),
        regulatoryVersionId: rule.regulatoryVersionId,
        sectorCode: rule.sectorCode,
        configurationStatus: rule.configurationStatus,
        provisionIds: [],
      } as ClassificationThresholds)
    : null;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      <Notice tone="blue" title="Never apply today's rules to a historical period">
        Only regulatory versions that are PUBLISHED (or SUPERSEDED but in force at the time) and whose validity window covers the measurement period end ({formatDate(period?.endDate)}) can be confirmed. The CODE_APPLICABILITY_AGENT (Phase 2) proposes a Code with competing interpretations; a human confirms it here.
      </Notice>
      <Card title="Regulatory frameworks and version applicable to this period" padded={false}>
        <Table>
          <thead><tr><Th>Framework</Th><Th>Version in force at period end</Th><Th>All versions</Th>{canManage && <Th>Confirm</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {candidates.map(({ framework, applicable, conflict }) => (
              <tr key={framework.id}>
                <Td><div className="font-medium">{framework.name}</div><div className="text-xs text-slate-500">{framework.code}</div></Td>
                <Td>{conflict ? <span className="text-red-700">{conflict}</span> : applicable ? applicable.label : <span className="text-amber-700">No published version covers this period</span>}</Td>
                <Td className="text-xs">
                  {framework.versions.map((v) => (
                    <div key={v.id} className="flex items-center gap-1.5"><StatusBadge status={v.status} /> {v.label} <span className="num whitespace-nowrap text-slate-500">({formatDate(v.validFrom)} → {formatDate(v.validTo)})</span></div>
                  ))}
                </Td>
                {canManage && (
                  <Td>
                    {applicable && (
                      <form action={confirmVersionAction.bind(null, engagementId)} className="flex gap-1.5">
                        <input type="hidden" name="versionId" value={applicable.id} />
                        <input name="reason" required placeholder="Basis for determination" className="input w-56" />
                        <Button size="sm" type="submit">Confirm</Button>
                      </form>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Entity classification">
          {!confirmed ? (
            <p className="text-sm text-slate-500">Confirm the regulatory version first.</p>
          ) : (
            <>
              <DL items={[["Verified turnover", e.verifiedTurnover?.toString() ?? "Not yet verified"], ["Thresholds", rule?.configurationStatus === CONFIGURED ? "Configured" : <StatusBadge key="s" status="REGULATORY_CONFIGURATION_REQUIRED" />], ["Engine result", classification ? <StatusBadge key="r" status={classification.classification} /> : "—"], ["Basis", classification?.notes.join(" ") || "—"]]} />
            </>
          )}
        </Card>
        <Card title="Scorecard template">
          {!confirmed ? (
            <p className="text-sm text-slate-500">Confirm the regulatory version first.</p>
          ) : canManage ? (
            <form action={selectTemplateAction.bind(null, engagementId)} className="space-y-2">
              <select name="templateId" defaultValue={e.scorecardTemplateId ?? ""} className="input" required>
                <option value="" disabled>Select…</option>
                {confirmed.scorecardTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input name="reason" placeholder="Reason (e.g. turnover band evidenced by AFS)" className="input" />
              <Button size="sm" type="submit">Apply template</Button>
            </form>
          ) : (
            <p className="text-sm">{confirmed.scorecardTemplates.find((t) => t.id === e.scorecardTemplateId)?.name ?? "Not selected"}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
