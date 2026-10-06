import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, DL, EmptyState, ErrorBanner, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requirePagePermission, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { can, NotFoundError, Permission } from "@/lib/rbac";
import { getScopedClient } from "@/lib/tenancy";
import { createEngagementAction } from "../actions";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  await requirePagePermission(user, Permission.CLIENT_VIEW);
  const { clientId } = await params;
  const { error } = await searchParams;
  try {
    await getScopedClient(user, clientId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { measuredEntities: true, engagements: { orderBy: { createdAt: "desc" }, include: { measurementPeriods: true, measuredEntity: true } } },
  });
  const canCreate = await can(user, Permission.ENGAGEMENT_MANAGE);
  const action = createEngagementAction.bind(null, client.id);

  return (
    <>
      <PageHeader eyebrow={<Link href="/clients" className="hover:underline">Clients</Link>} title={client.name} subtitle={client.registrationNumber ?? undefined} />
      <ErrorBanner message={error} />
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Verification engagements" padded={false}>
            {client.engagements.length === 0 ? (
              <div className="p-4"><EmptyState title="No engagements">Create the first verification engagement for this client.</EmptyState></div>
            ) : (
              <Table>
                <thead><tr><Th>Reference</Th><Th>Measured entity</Th><Th>Measurement period</Th><Th>Status</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {client.engagements.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <Td><Link href={`/engagements/${e.id}`} className="font-medium text-brand-700 hover:underline">{e.reference}</Link></Td>
                      <Td>{e.measuredEntity.legalName}</Td>
                      <Td className="num">{e.measurementPeriods[0] ? `${formatDate(e.measurementPeriods[0].startDate)} → ${formatDate(e.measurementPeriods[0].endDate)}` : "—"}</Td>
                      <Td><StatusBadge status={e.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card title="Client details">
            <DL items={[["Contact", client.contactName], ["Email", client.contactEmail], ["Measured entities", client.measuredEntities.map((m) => m.legalName).join(", ")], ["Created", formatDate(client.createdAt)]]} />
          </Card>
        </div>
        {canCreate && (
          <Card title="New engagement">
            <form action={action} className="space-y-3">
              <div>
                <label className="label">Measured entity</label>
                <select name="measuredEntityId" className="input" required>
                  {client.measuredEntities.map((m) => <option key={m.id} value={m.id}>{m.legalName}</option>)}
                </select>
              </div>
              <div><label className="label">Period label</label><input name="periodLabel" required className="input" placeholder="FY2026" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Period start</label><input name="startDate" type="date" required className="input" /></div>
                <div><label className="label">Period end</label><input name="endDate" type="date" required className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Financial year end</label><input name="financialYearEnd" type="date" required className="input" /></div>
                <div><label className="label">Prior cert. expiry</label><input name="previousCertificateExpiry" type="date" className="input" /></div>
              </div>
              <Button type="submit">Create engagement</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
