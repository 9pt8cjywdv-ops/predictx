import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { clientScope, engagementScope } from "@/lib/tenancy";

export const metadata = { title: "Dashboard" };

const ACTIVE = ["DRAFT", "EVIDENCE_COLLECTION", "ANALYSIS", "VERIFICATION_MANAGER_REVIEW", "RETURNED_FOR_CORRECTION"] as const;

export default async function Dashboard() {
  const user = await requireUser();
  const scope = engagementScope(user);
  const in90Days = new Date(Date.now() + 90 * 86400_000);

  const [clients, active, awaiting, review, completed, expiring, regulatoryPending, engagements] = await Promise.all([
    prisma.client.count({ where: clientScope(user) }),
    prisma.verificationEngagement.count({ where: { ...scope, status: { in: [...ACTIVE] } } }),
    prisma.verificationEngagement.count({ where: { ...scope, status: "AWAITING_CLIENT" } }),
    prisma.verificationEngagement.count({ where: { ...scope, status: "TECHNICAL_REVIEW" } }),
    prisma.verificationEngagement.count({ where: { ...scope, status: { in: ["APPROVED", "CLOSED"] } } }),
    prisma.verificationEngagement.count({ where: { ...scope, previousCertificateExpiry: { lte: in90Days, gte: new Date() } } }),
    user.role === "CLIENT_USER" ? 0 : prisma.regulatoryVersion.count({ where: { status: { in: ["DRAFT", "UNDER_REVIEW", "APPROVED"] } } }),
    prisma.verificationEngagement.findMany({
      where: scope,
      orderBy: { updatedAt: "desc" },
      take: 15,
      include: { client: true, measurementPeriods: true, _count: { select: { documents: true, queries: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader title={user.role === "CLIENT_USER" ? "My verifications" : "Dashboard"} subtitle={`Signed in as ${user.name}`} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Clients" value={clients} href={user.role === "CLIENT_USER" ? undefined : "/clients"} />
        <Stat label="Active verifications" value={active} href="/engagements?status=active" />
        <Stat label="Awaiting client" value={awaiting} href="/engagements?status=AWAITING_CLIENT" />
        <Stat label="Technical review" value={review} href="/engagements?status=TECHNICAL_REVIEW" />
        <Stat label="Completed" value={completed} href="/engagements?status=completed" />
        <Stat label="Expiring ≤ 90 days" value={expiring} hint="Re-verification due" />
        <Stat label="Regulatory updates" value={regulatoryPending} href={user.role === "CLIENT_USER" ? undefined : "/regulatory"} hint="Pending approval" />
      </div>
      <Card title="Recent engagements" padded={false}>
        {engagements.length === 0 ? (
          <div className="p-4"><EmptyState title="No engagements yet" /></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Reference</Th><Th>Client</Th><Th>Measurement period</Th><Th>Status</Th><Th>Documents</Th><Th>Queries</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {engagements.map((e) => {
                const p = e.measurementPeriods[0];
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" href={`/engagements/${e.id}`}>{e.reference}</Link></Td>
                    <Td>{e.client.name}</Td>
                    <Td className="num">{p ? `${formatDate(p.startDate)} → ${formatDate(p.endDate)}` : "—"}</Td>
                    <Td><StatusBadge status={e.status} /></Td>
                    <Td className="num">{e._count.documents}</Td>
                    <Td className="num">{e._count.queries}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
