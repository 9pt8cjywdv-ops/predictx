import { notFound } from "next/navigation";
import { AuditTable } from "@/components/AuditTable";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can, Permission } from "@/lib/rbac";
import { getScopedEngagement } from "@/lib/tenancy";

export default async function EngagementAudit({ params }: { params: Promise<{ engagementId: string }> }) {
  const user = await requireUser();
  if (!(await can(user, Permission.AUDIT_VIEW))) notFound();
  const { engagementId } = await params;
  await getScopedEngagement(user, engagementId);
  const events = await prisma.auditEvent.findMany({ where: { engagementId }, orderBy: { sequence: "desc" }, take: 500 });
  return (
    <Card title="Engagement audit trail" padded={false}>
      <AuditTable events={events} />
    </Card>
  );
}
