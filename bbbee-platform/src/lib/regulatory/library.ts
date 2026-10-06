import type { RegulatoryStatus } from "@prisma/client";
import { z } from "zod";
import { AuditEventType, recordAudit } from "../audit";
import { prisma } from "../db";
import { sha256Hex } from "../hash";
import { checkFileType } from "../ingestion/filetype";
import { ValidationError } from "../overrides";
import { Permission, requirePermission, type Principal } from "../rbac";
import { contentKey, storage } from "../storage";
import { RegulatoryWorkflowError } from "./service";
import { canTransition, requiresApprovalAuthority } from "./versions";

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const optionalDate = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Use YYYY-MM-DD" });
      return z.NEVER;
    }
    return new Date(`${v}T00:00:00Z`);
  });

export const RegulatoryDocumentSchema = z.object({
  frameworkId: optional(40),
  title: z.string().trim().min(3).max(300),
  source: z.string().trim().min(2).max(300),
  documentType: z.enum([
    "ACT", "AMENDMENT_ACT", "CODES_OF_GOOD_PRACTICE", "SECTOR_CODE", "CODE_AMENDMENT", "GAZETTE_NOTICE",
    "VERIFICATION_MANUAL", "PRACTICE_GUIDE", "CLARIFICATION", "APPROVED_INTERPRETATION", "OTHER_GUIDANCE",
  ]),
  gazetteNumber: optional(40),
  noticeNumber: optional(40),
  publicationDate: optionalDate,
  effectiveDate: optionalDate,
  expiryDate: optionalDate,
  sector: optional(80),
  version: z.string().trim().min(1).max(40),
});

/** Spec §54 step 1–3: upload a new authoritative source. It always starts as DRAFT. */
export async function addRegulatoryDocument(user: Principal, raw: unknown, file?: { name: string; data: Buffer }) {
  await requirePermission(user, Permission.REGULATORY_MANAGE);
  const parsed = RegulatoryDocumentSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  let sha256: string | undefined;
  let storageKey: string | undefined;
  if (file && file.data.length > 0) {
    const type = checkFileType(file.name, file.data);
    if (!type.ok || !["pdf", "docx"].includes(type.detected)) throw new ValidationError("Authoritative sources must be PDF or DOCX.");
    sha256 = sha256Hex(file.data);
    storageKey = contentKey("regulatory", sha256);
    await storage().putIfAbsent(storageKey, file.data, type.mimeType);
  }
  return prisma.$transaction(async (tx) => {
    const doc = await tx.regulatoryDocument.create({ data: { ...parsed.data, status: "DRAFT", sha256, storageKey } });
    await recordAudit(tx, {
      eventType: AuditEventType.REGULATORY_DOCUMENT_ADDED,
      organisationId: user.organisationId,
      userId: user.id,
      entityType: "RegulatoryDocument",
      entityId: doc.id,
      newValue: { title: doc.title, gazetteNumber: doc.gazetteNumber, sha256 },
    });
    return doc;
  });
}

export const ProvisionSchema = z.object({
  reference: z.string().trim().min(1).max(120),
  section: optional(60),
  subsection: optional(60),
  heading: optional(300),
  text: z.string().trim().min(10).max(50_000),
  element: z
    .enum(["OWNERSHIP", "MANAGEMENT_CONTROL", "SKILLS_DEVELOPMENT", "PREFERENTIAL_PROCUREMENT", "SUPPLIER_DEVELOPMENT", "ENTERPRISE_DEVELOPMENT", "SOCIO_ECONOMIC_DEVELOPMENT", "SECTOR_SPECIFIC", "GENERAL"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  indicatorCode: optional(80),
  effectiveFrom: optionalDate,
  effectiveTo: optionalDate,
  keywords: z.string().optional().transform((v) => (v ? v.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 30) : [])),
});

/** Spec §12 / §54 step 4: map an addressable provision from a source document (verbatim text). */
export async function addProvision(user: Principal, documentId: string, raw: unknown) {
  await requirePermission(user, Permission.REGULATORY_MANAGE);
  const parsed = ProvisionSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const doc = await prisma.regulatoryDocument.findUniqueOrThrow({ where: { id: documentId } });
  if (["SUPERSEDED", "WITHDRAWN"].includes(doc.status)) throw new RegulatoryWorkflowError("Cannot add provisions to a superseded or withdrawn source.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.regulatoryProvision.create({
      data: { ...parsed.data, documentId, sector: doc.sector, status: "DRAFT", effectiveFrom: parsed.data.effectiveFrom ?? doc.effectiveDate },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.REGULATORY_DOCUMENT_ADDED,
      organisationId: user.organisationId,
      userId: user.id,
      entityType: "RegulatoryProvision",
      entityId: p.id,
      newValue: { reference: p.reference, documentId },
    });
    return p;
  });
}

/** Document-level workflow; approving a source also approves its DRAFT/UNDER_REVIEW provisions. */
export async function transitionRegulatoryDocument(user: Principal, documentId: string, to: RegulatoryStatus, reason: string) {
  await requirePermission(user, requiresApprovalAuthority(to) ? Permission.REGULATORY_APPROVE : Permission.REGULATORY_MANAGE);
  if (!reason.trim()) throw new ValidationError("A reason is required.");
  return prisma.$transaction(async (tx) => {
    const doc = await tx.regulatoryDocument.findUniqueOrThrow({ where: { id: documentId } });
    if (!canTransition(doc.status, to)) throw new RegulatoryWorkflowError(`Cannot move source from ${doc.status} to ${to}.`);
    if ((to === "APPROVED" || to === "PUBLISHED") && !doc.sha256) {
      throw new RegulatoryWorkflowError("An authoritative source file must be uploaded before approval.");
    }
    const updated = await tx.regulatoryDocument.update({ where: { id: doc.id }, data: { status: to } });
    if (to === "APPROVED" || to === "PUBLISHED" || to === "UNDER_REVIEW") {
      await tx.regulatoryProvision.updateMany({
        where: { documentId: doc.id, status: { in: ["DRAFT", "UNDER_REVIEW", "APPROVED"] } },
        data: { status: to },
      });
    }
    await recordAudit(tx, {
      eventType: requiresApprovalAuthority(to) ? AuditEventType.APPROVAL : AuditEventType.REGULATORY_STATUS_CHANGED,
      organisationId: user.organisationId,
      userId: user.id,
      entityType: "RegulatoryDocument",
      entityId: doc.id,
      previousValue: { status: doc.status },
      newValue: { status: to },
      reason,
    });
    return updated;
  });
}
