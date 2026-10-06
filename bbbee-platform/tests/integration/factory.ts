import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Principal } from "@/lib/rbac";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/rbac/permissions";

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function makeOrg() {
  const org = await prisma.organisation.create({ data: { name: `Agency ${uid()}` } });
  await prisma.rolePermission.createMany({
    data: Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, ps]) => ps.map((permission) => ({ organisationId: org.id, role: role as Role, permission }))),
  });
  return org;
}

export async function makeUser(organisationId: string, role: Role): Promise<Principal> {
  const u = await prisma.user.create({ data: { organisationId, role, email: `${uid()}@t.test`, name: `${role} ${uid()}`, passwordHash: "x" } });
  return { id: u.id, organisationId, role, name: u.name, email: u.email };
}

export async function makeEngagement(organisationId: string) {
  const client = await prisma.client.create({ data: { organisationId, name: `Client ${uid()}` } });
  const entity = await prisma.measuredEntity.create({ data: { clientId: client.id, legalName: client.name } });
  const engagement = await prisma.verificationEngagement.create({
    data: {
      reference: `T-${uid()}`,
      clientId: client.id,
      measuredEntityId: entity.id,
      measurementPeriods: { create: { label: "FY", startDate: new Date("2025-03-01"), endDate: new Date("2026-02-28"), financialYearEnd: new Date("2026-02-28") } },
    },
  });
  return { client, entity, engagement };
}
