import { AuditTable } from "@/components/AuditTable";
import { Card, Notice, PageHeader } from "@/components/ui";
import { verifyAuditChain } from "@/lib/audit";
import { requirePagePermission, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/rbac";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ verify?: string }> }) {
  const user = await requireUser();
  await requirePagePermission(user, Permission.AUDIT_VIEW);
  const { verify } = await searchParams;
  const [events, chain] = await Promise.all([
    prisma.auditEvent.findMany({ where: { organisationId: user.organisationId }, orderBy: { sequence: "desc" }, take: 500 }),
    verify ? verifyAuditChain(prisma) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only, hash-chained record of every material action." actions={<a href="/audit?verify=1" className="text-sm text-brand-700 hover:underline">Verify chain integrity</a>} />
      {chain && (
        <div className="mb-4">
          {chain.ok ? (
            <Notice tone="green" title={`Chain verified — ${chain.checked} events intact`} />
          ) : (
            <Notice tone="red" title={`Chain broken at sequence ${chain.brokenAt}`}>Escalate to the platform administrator immediately.</Notice>
          )}
        </div>
      )}
      <Card padded={false}><AuditTable events={events} /></Card>
    </>
  );
}
