import type { RegulatoryStatus } from "@prisma/client";
import { AuditEventType, recordAudit } from "../audit";
import { prisma } from "../db";
import { ForbiddenError, Permission, requirePermission, type Principal } from "../rbac";
import { canTransition, IN_FORCE_STATUSES, requiresApprovalAuthority, selectVersionForDate, windowsOverlap } from "./versions";

export class RegulatoryWorkflowError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "RegulatoryWorkflowError";
  }
}

export async function resolveApplicableVersion(frameworkId: string, date: Date) {
  const versions = await prisma.regulatoryVersion.findMany({ where: { frameworkId, status: { in: IN_FORCE_STATUSES } } });
  return selectVersionForDate(versions, date);
}

export async function transitionRegulatoryVersion(user: Principal, versionId: string, to: RegulatoryStatus, notes?: string) {
  await requirePermission(user, requiresApprovalAuthority(to) ? Permission.REGULATORY_APPROVE : Permission.REGULATORY_MANAGE);
  return prisma.$transaction(async (tx) => {
    const v = await tx.regulatoryVersion.findUniqueOrThrow({ where: { id: versionId } });
    if (!canTransition(v.status, to)) throw new RegulatoryWorkflowError(`Cannot move regulatory version from ${v.status} to ${to}.`);

    if (to === "PUBLISHED") {
      if (!v.approvedById) throw new RegulatoryWorkflowError("Version must be approved before publication.");
      if (!v.validFrom) throw new RegulatoryWorkflowError("An effective (valid-from) date must be confirmed before publication.");
      const others = await tx.regulatoryVersion.findMany({
        where: { frameworkId: v.frameworkId, status: { in: IN_FORCE_STATUSES }, id: { not: v.id } },
      });
      const clash = others.find((o) => windowsOverlap(o, v));
      if (clash) throw new RegulatoryWorkflowError(`Validity window overlaps in-force version "${clash.label}". Set its valid-to date first.`);
    }
    if (to === "APPROVED") {
      const unconfigured = await tx.calculationRule.count({ where: { regulatoryVersionId: v.id, configurationStatus: { not: "CONFIGURED" } } });
      if (unconfigured > 0 && !notes) {
        throw new RegulatoryWorkflowError(`${unconfigured} calculation rule(s) are REGULATORY_CONFIGURATION_REQUIRED. Approval notes must acknowledge this.`);
      }
    }

    const updated = await tx.regulatoryVersion.update({
      where: { id: v.id },
      data: {
        status: to,
        ...(to === "APPROVED" ? { approvedById: user.id, approvedAt: new Date(), approvalNotes: notes ?? null } : {}),
        ...(to === "PUBLISHED" ? { publishedOn: new Date() } : {}),
      },
    });
    await recordAudit(tx, {
      eventType: to === "APPROVED" ? AuditEventType.APPROVAL : AuditEventType.REGULATORY_STATUS_CHANGED,
      organisationId: user.organisationId,
      userId: user.id,
      entityType: "RegulatoryVersion",
      entityId: v.id,
      previousValue: { status: v.status },
      newValue: { status: to },
      reason: notes,
    });
    return updated;
  });
}

/** Human confirmation of the Code/version applying to an engagement (spec §62 checklist item). */
export async function confirmEngagementRegulatoryVersion(user: Principal, engagementId: string, versionId: string, reason: string) {
  await requirePermission(user, Permission.ENGAGEMENT_MANAGE);
  if (!reason.trim()) throw new ForbiddenError("A reason is required.");
  return prisma.$transaction(async (tx) => {
    const eng = await tx.verificationEngagement.findFirstOrThrow({
      where: { id: engagementId, client: { organisationId: user.organisationId } },
      include: { measurementPeriods: true },
    });
    const version = await tx.regulatoryVersion.findUniqueOrThrow({ where: { id: versionId } });
    const period = eng.measurementPeriods.find((p) => p.isPrimary) ?? eng.measurementPeriods[0];
    if (!period) throw new RegulatoryWorkflowError("Engagement has no measurement period.");
    const applicable = selectVersionForDate([version], period.endDate);
    if (!applicable) {
      throw new RegulatoryWorkflowError(
        `Version "${version.label}" is not in force for the measurement period ending ${period.endDate.toISOString().slice(0, 10)}.`,
      );
    }
    const updated = await tx.verificationEngagement.update({
      where: { id: eng.id },
      data: { regulatoryVersionId: version.id, regulatoryConfirmedAt: new Date() },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.REGULATORY_VERSION_CONFIRMED,
      organisationId: user.organisationId,
      engagementId: eng.id,
      userId: user.id,
      entityType: "VerificationEngagement",
      entityId: eng.id,
      previousValue: { regulatoryVersionId: eng.regulatoryVersionId },
      newValue: { regulatoryVersionId: version.id },
      reason,
    });
    return updated;
  });
}
