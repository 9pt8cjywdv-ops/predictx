import type { AuditEvent } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime, humanize } from "@/lib/format";
import { Table, Td, Th } from "./ui";

function compact(v: unknown): string {
  if (v == null) return "";
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

export async function AuditTable({ events }: { events: AuditEvent[] }) {
  const userIds = [...new Set(events.map((e) => e.userId).filter(Boolean))] as string[];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <Table>
      <thead><tr><Th>#</Th><Th>When</Th><Th>Event</Th><Th>User</Th><Th>Entity</Th><Th>Previous</Th><Th>New</Th><Th>Reason</Th></tr></thead>
      <tbody className="divide-y divide-slate-100 text-xs">
        {events.length === 0 && <tr><Td colSpan={8} className="text-slate-500">No events.</Td></tr>}
        {events.map((e) => (
          <tr key={e.id}>
            <Td className="num text-slate-400">{e.sequence.toString()}</Td>
            <Td className="num whitespace-nowrap">{formatDateTime(e.createdAt)}</Td>
            <Td className="font-medium">{humanize(e.eventType)}</Td>
            <Td>{e.userId ? users.get(e.userId) ?? e.userId : "system"}</Td>
            <Td className="text-slate-500">{e.entityType}</Td>
            <Td className="max-w-xs break-all font-mono text-[11px] text-slate-500">{compact(e.previousValue)}</Td>
            <Td className="max-w-xs break-all font-mono text-[11px] text-slate-600">{compact(e.newValue)}</Td>
            <Td className="max-w-xs">{e.reason}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
