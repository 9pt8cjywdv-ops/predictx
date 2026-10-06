import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, DL, ErrorBanner, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requirePagePermission, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { REGULATORY_TRANSITIONS } from "@/lib/regulatory/versions";
import { transitionVersionAction } from "../../actions";

export default async function RegulatoryVersionPage({ params, searchParams }: { params: Promise<{ versionId: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  await requirePagePermission(user, Permission.REGULATORY_VIEW);
  const { versionId } = await params;
  const { error } = await searchParams;
  const v = await prisma.regulatoryVersion.findUnique({
    where: { id: versionId },
    include: {
      framework: true,
      approvedBy: { select: { name: true } },
      recognitionTables: true,
      classificationRules: true,
      scorecardTemplates: { include: { elements: { orderBy: { sortOrder: "asc" } } } },
      calculationRules: { orderBy: { indicatorCode: "asc" }, include: { provisions: true } },
    },
  });
  if (!v) notFound();
  const [canManage, canApprove] = await Promise.all([can(user, Permission.REGULATORY_MANAGE), can(user, Permission.REGULATORY_APPROVE)]);
  const transitions = REGULATORY_TRANSITIONS[v.status].filter((t) => (t === "APPROVED" || t === "PUBLISHED" ? canApprove : canManage));
  const unconfigured = v.calculationRules.filter((r) => r.configurationStatus !== "CONFIGURED").length;

  return (
    <>
      <PageHeader eyebrow={<Link href="/regulatory" className="hover:underline">Regulatory library</Link>} title={`${v.framework.name} — ${v.label}`} subtitle={<StatusBadge status={v.status} />} />
      <ErrorBanner message={error} />
      <div className="mt-4 space-y-6">
        {unconfigured > 0 && (
          <Notice tone="red" title={`${unconfigured} calculation rule(s) are REGULATORY_CONFIGURATION_REQUIRED`}>
            These indicators cannot produce points until their parameters are captured from an approved authoritative source and linked to provisions.
          </Notice>
        )}
        <div className="grid gap-6 xl:grid-cols-3">
          <Card title="Version" className="xl:col-span-2">
            <DL
              items={[
                ["Valid from", formatDate(v.validFrom)], ["Valid to", formatDate(v.validTo)], ["Published on", formatDate(v.publishedOn)],
                ["Approved by", v.approvedBy?.name], ["Approved at", formatDateTime(v.approvedAt)], ["Approval notes", v.approvalNotes],
                ["Regression status", v.regressionStatus ?? "Not run"],
                ["Recognition table", v.recognitionTables[0] ? <StatusBadge key="r" status={v.recognitionTables[0].configurationStatus} /> : "Missing"],
                ["Size thresholds", v.classificationRules[0] ? <StatusBadge key="t" status={v.classificationRules[0].configurationStatus} /> : "Missing"],
              ]}
            />
          </Card>
          {transitions.length > 0 && (
            <Card title="Approval workflow">
              <form action={transitionVersionAction.bind(null, v.id)} className="space-y-2">
                <select name="to" className="input">{transitions.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
                <textarea name="notes" rows={3} placeholder="Review / approval notes" className="input" />
                <Button size="sm" type="submit">Apply</Button>
              </form>
            </Card>
          )}
        </div>
        <Card title="Calculation rules" padded={false}>
          <Table>
            <thead><tr><Th>Indicator</Th><Th>Formula</Th><Th>Weighting</Th><Th>Cap</Th><Th>Rounding</Th><Th>Provisions</Th><Th>Configuration</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {v.calculationRules.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-xs">{r.indicatorCode}</Td>
                  <Td className="text-xs">{humanize(r.formulaType)}</Td>
                  <Td className="num">{r.weighting?.toString() ?? "—"}</Td>
                  <Td className="num">{r.cap?.toString() ?? "—"}</Td>
                  <Td className="text-xs">{r.roundingMethod}</Td>
                  <Td className="num">{r.provisions.length}</Td>
                  <Td><StatusBadge status={r.configurationStatus} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Scorecard templates">
          {v.scorecardTemplates.map((t) => (
            <div key={t.id} className="mb-3">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{t.elements.map((e) => <span key={e.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{e.name}{e.isPriorityElement ? " · priority" : ""}</span>)}</div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
