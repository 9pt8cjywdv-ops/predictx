import type { DocumentClass } from "@prisma/client";
import { AuditEventType, recordAudit } from "./audit";
import { prisma } from "./db";
import { Permission, requirePermission, type Principal } from "./rbac";
import { getScopedEngagement } from "./tenancy";

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Human correction of a document classification (spec §9, §34). The previous
 * (AI/heuristic) value is preserved in the Override row; never silently replaced.
 */
export async function reclassifyDocument(
  user: Principal,
  documentId: string,
  documentClass: DocumentClass,
  reason: string,
  comment?: string,
) {
  await requirePermission(user, Permission.DOCUMENT_CLASSIFY);
  if (!reason.trim()) throw new ValidationError("A reason is required for every override.");
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  await getScopedEngagement(user, doc.engagementId);
  if (doc.documentClass === documentClass) return doc;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: doc.id },
      data: {
        documentClass,
        classificationSource: "HUMAN",
        classificationConfidence: "HIGH",
        classifiedById: user.id,
        classifiedAt: new Date(),
        status: doc.status === "RECEIVED" ? "CLASSIFIED" : doc.status,
      },
    });
    const before = { documentClass: doc.documentClass, source: doc.classificationSource, confidence: doc.classificationConfidence };
    await tx.override.create({
      data: {
        engagementId: doc.engagementId,
        overrideType: "DOCUMENT_CLASSIFICATION",
        targetType: "Document",
        targetId: doc.id,
        field: "documentClass",
        aiValue: before,
        overrideValue: { documentClass },
        reason,
        comment,
        userId: user.id,
      },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.CLASSIFICATION_CHANGED,
      organisationId: user.organisationId,
      engagementId: doc.engagementId,
      userId: user.id,
      entityType: "Document",
      entityId: doc.id,
      previousValue: before,
      newValue: { documentClass },
      reason,
    });
    return updated;
  });
}

export async function softDeleteDocument(user: Principal, documentId: string, reason: string) {
  await requirePermission(user, Permission.DOCUMENT_DELETE);
  if (!reason.trim()) throw new ValidationError("A reason is required.");
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  await getScopedEngagement(user, doc.engagementId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date(), deletedReason: reason } });
    await recordAudit(tx, {
      eventType: AuditEventType.DOCUMENT_DELETED,
      organisationId: user.organisationId,
      engagementId: doc.engagementId,
      userId: user.id,
      entityType: "Document",
      entityId: doc.id,
      previousValue: { title: doc.title },
      reason,
    });
    return updated;
  });
}
