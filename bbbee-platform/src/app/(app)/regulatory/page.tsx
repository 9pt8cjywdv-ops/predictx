import Link from "next/link";
import { Button, Card, ErrorBanner, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requirePagePermission, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate, humanize } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { searchProvisions } from "@/lib/regulatory/search";
import { RegulatoryDocumentSchema } from "@/lib/regulatory/library";
import { addRegulatoryDocumentAction } from "./actions";

export const metadata = { title: "Regulatory library" };

export default async function RegulatoryLibrary({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const user = await requireUser();
  await requirePagePermission(user, Permission.REGULATORY_VIEW);
  const { error, q } = await searchParams;
  const [frameworks, documents, sectorCodes, canManage, hits] = await Promise.all([
    prisma.regulatoryFramework.findMany({ orderBy: { name: "asc" }, include: { versions: { orderBy: { createdAt: "desc" } } } }),
    prisma.regulatoryDocument.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { provisions: true } }, framework: true } }),
    prisma.sectorCode.findMany({ orderBy: { name: "asc" } }),
    can(user, Permission.REGULATORY_MANAGE),
    q ? searchProvisions(q, { includeDrafts: true, limit: 30 }) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Regulatory library" subtitle="Authoritative sources, addressable provisions and versioned scorecard configuration (Layer 1)." />
      <ErrorBanner message={error} />
      <div className="mt-4 space-y-6">
        <Notice tone="amber" title="No regulatory content is assumed">
          Rules, targets, weightings, thresholds and recognition tables are only used once captured from an uploaded authoritative source and approved. Anything else is REGULATORY_CONFIGURATION_REQUIRED and blocks calculation.
        </Notice>

        <Card title="Search provisions">
          <form className="flex gap-2">
            <input name="q" defaultValue={q} className="input" placeholder="e.g. net value, leviable amount, black designated group" />
            <Button variant="secondary" type="submit">Search</Button>
          </form>
          {q && (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {hits.length === 0 && <li className="py-2 text-slate-500">No provisions match.</li>}
              {hits.map((h) => (
                <li key={h.id} className="py-2">
                  <div className="font-medium">{h.reference} {h.heading && `— ${h.heading}`}</div>
                  <div className="text-xs text-slate-500">{h.documentTitle}</div>
                  <div className="mt-1 text-xs">
                    {h.snippet.split(/(⟦[^⟧]*⟧)/).map((part, i) =>
                      part.startsWith("⟦") ? <mark key={i} className="bg-amber-100">{part.slice(1, -1)}</mark> : <span key={i}>{part}</span>,
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Frameworks and regulatory versions" padded={false}>
          <Table>
            <thead><tr><Th>Framework</Th><Th>Version</Th><Th>Status</Th><Th>Valid from</Th><Th>Valid to</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {frameworks.flatMap((f) =>
                f.versions.length === 0
                  ? [<tr key={f.id}><Td className="font-medium">{f.name}</Td><Td colSpan={4} className="text-slate-500">No versions</Td></tr>]
                  : f.versions.map((v, i) => (
                      <tr key={v.id}>
                        <Td className="font-medium">{i === 0 ? f.name : ""}</Td>
                        <Td><Link href={`/regulatory/versions/${v.id}`} className="text-brand-700 hover:underline">{v.label}</Link></Td>
                        <Td><StatusBadge status={v.status} /></Td>
                        <Td className="num">{formatDate(v.validFrom)}</Td>
                        <Td className="num">{formatDate(v.validTo)}</Td>
                      </tr>
                    )),
              )}
            </tbody>
          </Table>
        </Card>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card title="Source documents" padded={false} className="xl:col-span-2">
            <Table>
              <thead><tr><Th>Title</Th><Th>Type</Th><Th>Gazette</Th><Th>Effective</Th><Th>Provisions</Th><Th>Source file</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((d) => (
                  <tr key={d.id}>
                    <Td><Link href={`/regulatory/documents/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.title}</Link><div className="text-xs text-slate-500">{d.source}</div></Td>
                    <Td className="text-xs">{humanize(d.documentType)}</Td>
                    <Td className="num">{d.gazetteNumber ?? <span className="text-amber-700">Unconfirmed</span>}</Td>
                    <Td className="num">{formatDate(d.effectiveDate)}</Td>
                    <Td className="num">{d._count.provisions}</Td>
                    <Td>{d.sha256 ? <StatusBadge status="CLEAN" /> : <span className="text-xs text-amber-700">Awaiting upload</span>}</Td>
                    <Td><StatusBadge status={d.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {canManage && (
            <Card title="Add authoritative source">
              <form action={addRegulatoryDocumentAction} className="space-y-2.5">
                <div><label className="label">Title</label><input name="title" required className="input" /></div>
                <div><label className="label">Source / publisher</label><input name="source" required className="input" placeholder="Government Gazette / dtic" /></div>
                <div>
                  <label className="label">Type</label>
                  <select name="documentType" className="input">{RegulatoryDocumentSchema.shape.documentType.options.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
                </div>
                <div>
                  <label className="label">Framework</label>
                  <select name="frameworkId" className="input"><option value="">—</option>{frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Gazette no.</label><input name="gazetteNumber" className="input" /></div>
                  <div><label className="label">Notice no.</label><input name="noticeNumber" className="input" /></div>
                  <div><label className="label">Published</label><input type="date" name="publicationDate" className="input" /></div>
                  <div><label className="label">Effective</label><input type="date" name="effectiveDate" className="input" /></div>
                  <div><label className="label">Expiry / replaced</label><input type="date" name="expiryDate" className="input" /></div>
                  <div><label className="label">Version</label><input name="version" required className="input" /></div>
                </div>
                <div>
                  <label className="label">Sector</label>
                  <select name="sector" className="input"><option value="">Generic</option>{sectorCodes.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}</select>
                </div>
                <div><label className="label">Source file (PDF/DOCX)</label><input type="file" name="file" accept=".pdf,.docx" className="text-xs" /></div>
                <Button type="submit">Add as draft</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
