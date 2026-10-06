import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, DL, ErrorBanner, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requirePagePermission, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate, humanize } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { ElementSchema } from "@/lib/agents/contracts";
import { REGULATORY_TRANSITIONS } from "@/lib/regulatory/versions";
import { addProvisionAction, transitionDocumentAction } from "../../actions";

export default async function RegulatoryDocumentPage({ params, searchParams }: { params: Promise<{ documentId: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  await requirePagePermission(user, Permission.REGULATORY_VIEW);
  const { documentId } = await params;
  const { error } = await searchParams;
  const doc = await prisma.regulatoryDocument.findUnique({
    where: { id: documentId },
    include: { provisions: { orderBy: { reference: "asc" } }, framework: true, supersededBy: true },
  });
  if (!doc) notFound();
  const [canManage, canApprove] = await Promise.all([can(user, Permission.REGULATORY_MANAGE), can(user, Permission.REGULATORY_APPROVE)]);
  const transitions = REGULATORY_TRANSITIONS[doc.status].filter((t) => (t === "APPROVED" || t === "PUBLISHED" ? canApprove : canManage));

  return (
    <>
      <PageHeader eyebrow={<Link href="/regulatory" className="hover:underline">Regulatory library</Link>} title={doc.title} subtitle={<StatusBadge status={doc.status} />} />
      <ErrorBanner message={error} />
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Source metadata">
            <DL
              items={[
                ["Source", doc.source], ["Type", humanize(doc.documentType)], ["Framework", doc.framework?.name], ["Version", doc.version],
                ["Gazette number", doc.gazetteNumber], ["Notice number", doc.noticeNumber], ["Publication date", formatDate(doc.publicationDate)],
                ["Effective date", formatDate(doc.effectiveDate)], ["Expiry / replacement", formatDate(doc.expiryDate)], ["Sector", doc.sector ?? "Generic"],
                ["Superseded by", doc.supersededBy?.title], ["SHA-256", doc.sha256 ? <span key="h" className="font-mono text-xs">{doc.sha256}</span> : "No source file uploaded"],
              ]}
            />
          </Card>
          <Card title={`Provisions (${doc.provisions.length})`} padded={false}>
            <Table>
              <thead><tr><Th>Reference</Th><Th>Heading / text</Th><Th>Element</Th><Th>Effective</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {doc.provisions.length === 0 && <tr><Td colSpan={5} className="text-slate-500">No provisions mapped yet.</Td></tr>}
                {doc.provisions.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap font-mono text-xs">{p.reference}</Td>
                    <Td><div className="font-medium">{p.heading}</div><div className="line-clamp-3 text-xs text-slate-600">{p.text}</div></Td>
                    <Td className="text-xs">{p.element ? humanize(p.element) : "—"}{p.indicatorCode && <div className="font-mono">{p.indicatorCode}</div>}</Td>
                    <Td className="num text-xs">{formatDate(p.effectiveFrom)} → {formatDate(p.effectiveTo)}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          {transitions.length > 0 && (
            <Card title="Workflow">
              <form action={transitionDocumentAction.bind(null, doc.id)} className="space-y-2">
                <select name="to" className="input">{transitions.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
                <input name="reason" required placeholder="Reason / review reference" className="input" />
                <Button size="sm" type="submit">Apply</Button>
                <p className="text-xs text-slate-500">Approval and publication require the regulatory approval permission and an uploaded source file.</p>
              </form>
            </Card>
          )}
          {canManage && (
            <Card title="Map provision (verbatim text)">
              <form action={addProvisionAction.bind(null, doc.id)} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Reference</label><input name="reference" required className="input" placeholder="Statement 100, 3.1" /></div>
                  <div><label className="label">Section</label><input name="section" className="input" /></div>
                </div>
                <div><label className="label">Heading</label><input name="heading" className="input" /></div>
                <div><label className="label">Text</label><textarea name="text" required minLength={10} rows={5} className="input" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Element</label>
                    <select name="element" className="input"><option value="">—</option>{ElementSchema.options.map((e) => <option key={e} value={e}>{humanize(e)}</option>)}</select>
                  </div>
                  <div><label className="label">Indicator code</label><input name="indicatorCode" className="input" /></div>
                  <div><label className="label">Effective from</label><input type="date" name="effectiveFrom" className="input" /></div>
                  <div><label className="label">Effective to</label><input type="date" name="effectiveTo" className="input" /></div>
                </div>
                <div><label className="label">Keywords (comma separated)</label><input name="keywords" className="input" /></div>
                <Button size="sm" type="submit">Add provision</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
