import { describe, expect, it } from "vitest";
import { recordAudit, verifyAuditChain, AuditEventType } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { makeEngagement, makeOrg, makeUser } from "./factory";

describe("database-enforced immutability", () => {
  it("audit events are hash-chained and verifiable", async () => {
    const org = await makeOrg();
    for (let i = 0; i < 5; i++) {
      await prisma.$transaction((tx) => recordAudit(tx, { eventType: AuditEventType.LOGIN, organisationId: org.id, newValue: { i } }));
    }
    const res = await verifyAuditChain(prisma);
    expect(res.ok).toBe(true);
    expect(res.checked).toBeGreaterThanOrEqual(5);
  });

  it("concurrent writers still produce a valid chain", async () => {
    const org = await makeOrg();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => prisma.$transaction((tx) => recordAudit(tx, { eventType: AuditEventType.LOGIN, organisationId: org.id, newValue: { i } }))),
    );
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("audit events cannot be updated or deleted", async () => {
    const e = await prisma.$transaction((tx) => recordAudit(tx, { eventType: AuditEventType.LOGIN }));
    await expect(prisma.auditEvent.update({ where: { id: e.id }, data: { reason: "tamper" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET "reason"='x'`)).rejects.toThrow(/append-only/);
  });

  it("original document bytes metadata cannot change; scan status can progress", async () => {
    const org = await makeOrg();
    const user = await makeUser(org.id, "VERIFICATION_ANALYST");
    const { engagement } = await makeEngagement(org.id);
    const doc = await prisma.document.create({ data: { engagementId: engagement.id, title: "a.pdf" } });
    const v = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, originalFilename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64), storageKey: "k", uploadedById: user.id },
    });
    await expect(prisma.documentVersion.update({ where: { id: v.id }, data: { sha256: "b".repeat(64) } })).rejects.toThrow(/immutable/);
    await expect(prisma.documentVersion.delete({ where: { id: v.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.documentVersion.update({ where: { id: v.id }, data: { scanStatus: "CLEAN" } })).resolves.toMatchObject({ scanStatus: "CLEAN" });
  });

  it("overrides and snapshots are append-only", async () => {
    const org = await makeOrg();
    const user = await makeUser(org.id, "VERIFICATION_MANAGER");
    const { engagement } = await makeEngagement(org.id);
    const o = await prisma.override.create({
      data: { engagementId: engagement.id, overrideType: "X", targetType: "T", targetId: "1", field: "f", overrideValue: 1, reason: "r", userId: user.id },
    });
    await expect(prisma.override.update({ where: { id: o.id }, data: { reason: "changed" } })).rejects.toThrow(/append-only/);
    const s = await prisma.verificationSnapshot.create({ data: { engagementId: engagement.id, milestone: "INITIAL_ASSESSMENT", payload: {}, payloadHash: "h", createdById: user.id } });
    await expect(prisma.verificationSnapshot.delete({ where: { id: s.id } })).rejects.toThrow(/append-only/);
  });
});
