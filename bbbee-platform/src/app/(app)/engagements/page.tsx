import Link from "next/link";
import type { EngagementStatus, Prisma } from "@prisma/client";
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { engagementScope } from "@/lib/tenancy";

export const metadata = { title: "Engagements" };

const GROUPS: Record<string, EngagementStatus[]> = {
  active: ["DRAFT", "EVIDENCE_COLLECTION", "ANALYSIS", "VERIFICATION_MANAGER_REVIEW", "RETURNED_FOR_CORRECTION"],
  completed: ["APPROVED", "CLOSED"],
};

export default async function EngagementsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { status } = await searchParams;
  const where: Prisma.VerificationEngagementWhereInput = { ...engagementScope(user) };
  if (status && GROUPS[status]) where.status = { in: GROUPS[status] };
  else if (status) where.status = status as EngagementStatus;

  const engagements = await prisma.verificationEngagement.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { client: true, measurementPeriods: true, manager: true, regulatoryVersion: true },
  });

  return (
    <>
      <PageHeader title="Verification engagements" subtitle={status ? `Filter: ${status}` : `${engagements.length} engagement(s)`} />
      <Card padded={false}>
        {engagements.length === 0 ? (
          <div className="p-4"><EmptyState title="No engagements match" /></div>
        ) : (
          <Table>
            <thead><tr><Th>Reference</Th><Th>Client</Th><Th>Period end</Th><Th>Classification</Th><Th>Code version</Th><Th>Manager</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {engagements.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <Td><Link className="font-medium text-brand-700 hover:underline" href={`/engagements/${e.id}`}>{e.reference}</Link></Td>
                  <Td>{e.client.name}</Td>
                  <Td className="num">{formatDate(e.measurementPeriods[0]?.endDate)}</Td>
                  <Td><StatusBadge status={e.entityClassification} /></Td>
                  <Td className="text-xs">{e.regulatoryVersion?.label ?? <span className="text-amber-700">Not confirmed</span>}</Td>
                  <Td>{e.manager?.name ?? "—"}</Td>
                  <Td><StatusBadge status={e.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
