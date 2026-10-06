import { Badge, Button, Card, EmptyState, ErrorBanner, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Uploader } from "@/components/Uploader";
import { DocumentClassSchema } from "@/lib/agents/contracts";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatBytes, formatDateTime, humanize } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { getScopedEngagement } from "@/lib/tenancy";
import { deleteDocumentAction, reclassifyAction } from "../actions";

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ engagementId: string }>; searchParams: Promise<{ error?: string; class?: string }> }) {
  const user = await requireUser();
  const { engagementId } = await params;
  const sp = await searchParams;
  await getScopedEngagement(user, engagementId);
  const [canUpload, canClassify, canDelete] = await Promise.all([
    can(user, Permission.DOCUMENT_UPLOAD),
    can(user, Permission.DOCUMENT_CLASSIFY),
    can(user, Permission.DOCUMENT_DELETE),
  ]);
  const isClient = user.role === "CLIENT_USER";

  const documents = await prisma.document.findMany({
    where: { engagementId, deletedAt: null, ...(sp.class ? { documentClass: sp.class as never } : {}), ...(isClient ? { versions: { some: { uploadedById: user.id } } } : {}) },
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { uploadedBy: { select: { name: true } } } }, sourceArchive: { select: { title: true } }, classifiedBy: { select: { name: true } } },
    take: 1000,
  });

  return (
    <div className="space-y-6">
      <ErrorBanner message={sp.error} />
      {canUpload && (
        <Card title="Upload evidence">
          <Uploader engagementId={engagementId} />
        </Card>
      )}
      <Card title={`Document register (${documents.length})`} padded={false}>
        {documents.length === 0 ? (
          <div className="p-4"><EmptyState title="No documents">Upload the verification file to begin.</EmptyState></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Document</Th><Th>Classification</Th><Th>Status</Th><Th>Scan</Th><Th>SHA-256</Th><Th>Uploaded</Th>{!isClient && <Th>Actions</Th>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) => {
                const v = d.versions[0];
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <Td>
                      {v ? <a href={`/api/documents/${v.id}`} className="font-medium text-brand-700 hover:underline">{d.title}</a> : d.title}
                      <div className="text-xs text-slate-500">
                        {v && `${v.detectedType?.toUpperCase()} · ${formatBytes(v.sizeBytes)}`}
                        {d.sourceArchive && ` · from ${d.sourceArchive.title}`}
                        {d.duplicateOfId && " · duplicate of earlier upload"}
                      </div>
                    </Td>
                    <Td>
                      <div>{humanize(d.documentClass)}</div>
                      <div className="mt-0.5 flex gap-1">
                        <Badge tone={d.classificationSource === "HUMAN" ? "green" : "gray"}>{d.classificationSource}</Badge>
                        <StatusBadge status={d.classificationConfidence} />
                      </div>
                      {d.classifiedBy && <div className="text-xs text-slate-500">by {d.classifiedBy.name}</div>}
                    </Td>
                    <Td><StatusBadge status={d.status} /></Td>
                    <Td>{v && <StatusBadge status={v.scanStatus} />}</Td>
                    <Td className="font-mono text-[11px] text-slate-500" >{v ? `${v.sha256.slice(0, 12)}…` : ""}</Td>
                    <Td className="text-xs">{v && <>{formatDateTime(v.uploadedAt)}<div className="text-slate-500">{v.uploadedBy.name}</div></>}</Td>
                    {!isClient && (
                      <Td>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-brand-700">Review</summary>
                          <div className="mt-2 w-72 space-y-3">
                            {canClassify && (
                              <form action={reclassifyAction.bind(null, engagementId, d.id)} className="space-y-1.5">
                                <select name="documentClass" defaultValue={d.documentClass} className="input">
                                  {DocumentClassSchema.options.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                                </select>
                                <input name="reason" required placeholder="Reason for classification override" className="input" />
                                <Button size="sm" type="submit">Override classification</Button>
                              </form>
                            )}
                            {canDelete && (
                              <form action={deleteDocumentAction.bind(null, engagementId, d.id)} className="space-y-1.5 border-t border-slate-100 pt-2">
                                <input name="reason" required placeholder="Reason for removal" className="input" />
                                <Button size="sm" variant="secondary" type="submit">Remove from register</Button>
                                <p className="text-[11px] text-slate-500">The original is retained; removal is audited.</p>
                              </form>
                            )}
                          </div>
                        </details>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
