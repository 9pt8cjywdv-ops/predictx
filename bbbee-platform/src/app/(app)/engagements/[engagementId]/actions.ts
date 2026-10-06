"use server";

import type { DocumentClass } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { reclassifyDocument, softDeleteDocument, ValidationError } from "@/lib/overrides";
import { DocumentClassSchema } from "@/lib/agents/contracts";
import { Permission, requirePermission } from "@/lib/rbac";
import { confirmEngagementRegulatoryVersion } from "@/lib/regulatory/service";
import { runProvisionalScorecard } from "@/lib/scoring";
import { getScopedEngagement } from "@/lib/tenancy";
import { AuditEventType, recordAudit } from "@/lib/audit";

function fail(path: string, e: unknown): never {
  const known = e instanceof Error && "status" in e;
  if (!known) console.error(e);
  redirect(`${path}?error=${encodeURIComponent(known ? (e as Error).message : "Unexpected error.")}`);
}

export async function reclassifyAction(engagementId: string, documentId: string, form: FormData) {
  const user = await requireUser();
  const path = `/engagements/${engagementId}/documents`;
  try {
    const cls = DocumentClassSchema.safeParse(form.get("documentClass"));
    if (!cls.success) throw new ValidationError("Invalid document class.");
    await reclassifyDocument(user, documentId, cls.data as DocumentClass, String(form.get("reason") ?? ""), String(form.get("comment") ?? "") || undefined);
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function deleteDocumentAction(engagementId: string, documentId: string, form: FormData) {
  const user = await requireUser();
  const path = `/engagements/${engagementId}/documents`;
  try {
    await softDeleteDocument(user, documentId, String(form.get("reason") ?? ""));
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function confirmVersionAction(engagementId: string, form: FormData) {
  const user = await requireUser();
  const path = `/engagements/${engagementId}/code-applicability`;
  try {
    await confirmEngagementRegulatoryVersion(user, engagementId, String(form.get("versionId")), String(form.get("reason") ?? ""));
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function selectTemplateAction(engagementId: string, form: FormData) {
  const user = await requireUser();
  const path = `/engagements/${engagementId}/code-applicability`;
  try {
    await requirePermission(user, Permission.ENGAGEMENT_MANAGE);
    const eng = await getScopedEngagement(user, engagementId);
    const templateId = String(form.get("templateId"));
    const template = await prisma.scorecardTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.regulatoryVersionId !== eng.regulatoryVersionId) {
      throw new ValidationError("Template must belong to the confirmed regulatory version.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.verificationEngagement.update({ where: { id: eng.id }, data: { scorecardTemplateId: template.id, entityClassification: template.entityClassification } });
      await recordAudit(tx, {
        eventType: AuditEventType.CLASSIFICATION_CHANGED,
        organisationId: user.organisationId,
        engagementId: eng.id,
        userId: user.id,
        entityType: "VerificationEngagement",
        entityId: eng.id,
        previousValue: { scorecardTemplateId: eng.scorecardTemplateId, entityClassification: eng.entityClassification },
        newValue: { scorecardTemplateId: template.id, entityClassification: template.entityClassification },
        reason: String(form.get("reason") ?? "") || "Scorecard template selected",
      });
    });
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function runScorecardAction(engagementId: string) {
  const user = await requireUser();
  const path = `/engagements/${engagementId}/scorecard`;
  try {
    await runProvisionalScorecard(user, engagementId);
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}
