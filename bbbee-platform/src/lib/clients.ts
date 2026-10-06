import { z } from "zod";
import { AuditEventType, recordAudit } from "./audit";
import { prisma } from "./db";
import { ValidationError } from "./overrides";
import { Permission, requirePermission, type Principal } from "./rbac";
import { getScopedClient } from "./tenancy";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const CreateClientSchema = z.object({
  name: z.string().trim().min(2).max(200),
  registrationNumber: optionalText(40),
  contactName: optionalText(120),
  contactEmail: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  industryDescription: optionalText(500),
});

export async function createClient(user: Principal, raw: unknown) {
  await requirePermission(user, Permission.CLIENT_MANAGE);
  const parsed = CreateClientSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const d = parsed.data;
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        organisationId: user.organisationId,
        name: d.name,
        registrationNumber: d.registrationNumber,
        contactName: d.contactName,
        contactEmail: d.contactEmail,
        measuredEntities: {
          create: { legalName: d.name, registrationNumber: d.registrationNumber, industryDescription: d.industryDescription },
        },
      },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.CLIENT_CREATED,
      organisationId: user.organisationId,
      userId: user.id,
      entityType: "Client",
      entityId: client.id,
      newValue: { name: d.name, registrationNumber: d.registrationNumber ?? null },
    });
    return client;
  });
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").transform((s) => new Date(`${s}T00:00:00Z`));

export const CreateEngagementSchema = z
  .object({
    measuredEntityId: z.string().min(1),
    periodLabel: z.string().trim().min(1).max(40),
    startDate: isoDate,
    endDate: isoDate,
    financialYearEnd: isoDate,
    previousCertificateExpiry: isoDate.optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((d) => d.endDate > d.startDate, { message: "Measurement period end must be after start.", path: ["endDate"] })
  .refine((d) => d.endDate.getTime() - d.startDate.getTime() <= 400 * 86400_000, { message: "Measurement period exceeds 13 months.", path: ["endDate"] });

async function nextReference(year: number): Promise<string> {
  const count = await prisma.verificationEngagement.count({ where: { reference: { startsWith: `VER-${year}-` } } });
  return `VER-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function createEngagement(user: Principal, clientId: string, raw: unknown) {
  await requirePermission(user, Permission.ENGAGEMENT_MANAGE);
  const client = await getScopedClient(user, clientId);
  const parsed = CreateEngagementSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const d = parsed.data;
  const entity = await prisma.measuredEntity.findFirst({ where: { id: d.measuredEntityId, clientId: client.id } });
  if (!entity) throw new ValidationError("Measured entity does not belong to this client.");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const engagement = await tx.verificationEngagement.create({
          data: {
            reference: await nextReference(d.endDate.getUTCFullYear()),
            clientId: client.id,
            measuredEntityId: entity.id,
            status: "DRAFT",
            managerId: user.role === "VERIFICATION_MANAGER" ? user.id : undefined,
            previousCertificateExpiry: d.previousCertificateExpiry,
            measurementPeriods: {
              create: { label: d.periodLabel, startDate: d.startDate, endDate: d.endDate, financialYearEnd: d.financialYearEnd, isPrimary: true },
            },
          },
        });
        await recordAudit(tx, {
          eventType: AuditEventType.ENGAGEMENT_CREATED,
          organisationId: user.organisationId,
          engagementId: engagement.id,
          userId: user.id,
          entityType: "VerificationEngagement",
          entityId: engagement.id,
          newValue: { reference: engagement.reference, measuredEntityId: entity.id, period: { start: d.startDate, end: d.endDate } },
        });
        return engagement;
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // retry on reference collision
    }
  }
  throw new Error("Could not allocate an engagement reference.");
}
