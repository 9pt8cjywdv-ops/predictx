import Link from "next/link";
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Table, Td, Th } from "@/components/ui";
import { requirePagePermission, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { can, Permission } from "@/lib/rbac";
import { clientScope } from "@/lib/tenancy";
import { createClientAction } from "./actions";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  await requirePagePermission(user, Permission.CLIENT_VIEW);
  const { error } = await searchParams;
  const [clients, canManage] = await Promise.all([
    prisma.client.findMany({ where: clientScope(user), orderBy: { name: "asc" }, include: { _count: { select: { engagements: true } } } }),
    can(user, Permission.CLIENT_MANAGE),
  ]);

  return (
    <>
      <PageHeader title="Clients" subtitle={`${clients.length} client${clients.length === 1 ? "" : "s"}`} />
      <ErrorBanner message={error} />
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <Card title="Client register" padded={false} className="xl:col-span-2">
          {clients.length === 0 ? (
            <div className="p-4"><EmptyState title="No clients yet" /></div>
          ) : (
            <Table>
              <thead><tr><Th>Name</Th><Th>Registration no.</Th><Th>Contact</Th><Th>Engagements</Th><Th>Created</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td><Link href={`/clients/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link></Td>
                    <Td className="num">{c.registrationNumber ?? "—"}</Td>
                    <Td>{c.contactName ?? "—"}</Td>
                    <Td className="num">{c._count.engagements}</Td>
                    <Td className="num">{formatDate(c.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        {canManage && (
          <Card title="New client">
            <form action={createClientAction} className="space-y-3">
              <div><label className="label">Legal name</label><input name="name" required minLength={2} maxLength={200} className="input" /></div>
              <div><label className="label">Company registration no.</label><input name="registrationNumber" maxLength={40} className="input" placeholder="e.g. 2015/123456/07" /></div>
              <div><label className="label">Industry / activities</label><textarea name="industryDescription" maxLength={500} rows={2} className="input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Contact name</label><input name="contactName" maxLength={120} className="input" /></div>
                <div><label className="label">Contact email</label><input name="contactEmail" type="email" className="input" /></div>
              </div>
              <Button type="submit">Create client</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
