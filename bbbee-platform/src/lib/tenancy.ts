import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { NotFoundError, type Principal } from "./rbac";

/**
 * Tenant isolation. Every engagement/client read goes through these scopes:
 *  - staff see their own organisation's clients only;
 *  - CLIENT_USER sees only clients explicitly granted via ClientUserAccess.
 * A record outside scope is reported as NOT FOUND (no existence leak).
 */
export function clientScope(user: Principal): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { organisationId: user.organisationId };
  if (user.role === "CLIENT_USER") return { ...base, userAccess: { some: { userId: user.id } } };
  return base;
}

export function engagementScope(user: Principal): Prisma.VerificationEngagementWhereInput {
  return { client: clientScope(user) };
}

export async function getScopedEngagement(user: Principal, engagementId: string) {
  const engagement = await prisma.verificationEngagement.findFirst({
    where: { id: engagementId, ...engagementScope(user) },
    include: { client: true, measuredEntity: true, measurementPeriods: true, regulatoryVersion: { include: { framework: true } } },
  });
  if (!engagement) throw new NotFoundError("Engagement not found.");
  return engagement;
}

export async function getScopedClient(user: Principal, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, ...clientScope(user) } });
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}
