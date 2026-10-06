import type { Document, DocumentVersion } from "@prisma/client";
import { AuditEventType, recordAudit } from "../audit";
import { prisma } from "../db";
import { env } from "../env";
import { sha256Hex } from "../hash";
import type { Principal } from "../rbac";
import { contentKey, storage } from "../storage";
import { classifyByHeuristic } from "./classify";
import { checkFileType, sanitizeFilename } from "./filetype";
import { malwareScanner } from "./scan";
import { expandZip, UnsafeArchiveError } from "./zip";

export type IngestOutcome =
  | { kind: "STORED"; filename: string; document: Document; version: DocumentVersion; quarantined: boolean }
  | { kind: "DUPLICATE"; filename: string; document: Document; duplicateOfId: string }
  | { kind: "ARCHIVE"; filename: string; document: Document; members: IngestOutcome[] }
  | { kind: "REJECTED"; filename: string; reason: string };

export interface IngestRequest {
  user: Principal;
  engagementId: string;
  filename: string;
  data: Buffer;
  sourceArchiveId?: string;
  depth?: number;
  ip?: string | null;
}

const MAX_ARCHIVE_DEPTH = 2;

/**
 * Spec §8 pipeline (Phase 1 portion):
 *   security check → hash → duplicate detection → classify (heuristic) → store
 *   original immutably → provenance + audit. Extraction runs in Phase 2.
 * Caller is responsible for authorising `user` against `engagementId`.
 */
export async function ingestFile(req: IngestRequest): Promise<IngestOutcome> {
  const filename = sanitizeFilename(req.filename);
  const depth = req.depth ?? 0;
  const e = env();

  const reject = async (reason: string): Promise<IngestOutcome> => {
    await prisma.$transaction((tx) =>
      recordAudit(tx, {
        eventType: AuditEventType.DOCUMENT_QUARANTINED,
        organisationId: req.user.organisationId,
        engagementId: req.engagementId,
        userId: req.user.id,
        entityType: "Upload",
        newValue: { filename, sizeBytes: req.data.length, sha256: sha256Hex(req.data) },
        reason,
        ipAddress: req.ip,
      }),
    );
    return { kind: "REJECTED", filename, reason };
  };

  if (req.data.length === 0) return reject("Empty file.");
  if (req.data.length > e.MAX_UPLOAD_BYTES) return reject(`File exceeds ${e.MAX_UPLOAD_BYTES} bytes.`);

  const type = checkFileType(filename, req.data);
  if (!type.ok) return reject(type.reason!);

  let scan;
  try {
    scan = await malwareScanner().scan(req.data);
  } catch (err) {
    return reject(`Malware scan failed: ${(err as Error).message}`);
  }
  if (scan.status === "INFECTED") return reject(`Malware detected: ${scan.detail}`);

  const sha256 = sha256Hex(req.data);
  const storageKey = contentKey("documents", sha256);

  const existing = await prisma.documentVersion.findFirst({
    where: { sha256, document: { engagementId: req.engagementId, deletedAt: null } },
    include: { document: true },
    orderBy: { uploadedAt: "asc" },
  });

  if (existing) {
    const document = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          engagementId: req.engagementId,
          title: filename,
          documentClass: existing.document.documentClass,
          classificationSource: existing.document.classificationSource,
          status: "DUPLICATE",
          duplicateOfId: existing.documentId,
          sourceArchiveId: req.sourceArchiveId,
        },
      });
      await recordAudit(tx, {
        eventType: AuditEventType.DOCUMENT_DUPLICATE_DETECTED,
        organisationId: req.user.organisationId,
        engagementId: req.engagementId,
        userId: req.user.id,
        entityType: "Document",
        entityId: doc.id,
        newValue: { filename, sha256, duplicateOfId: existing.documentId },
        ipAddress: req.ip,
      });
      return doc;
    });
    return { kind: "DUPLICATE", filename, document, duplicateOfId: existing.documentId };
  }

  await storage().putIfAbsent(storageKey, req.data, type.mimeType);

  const isArchive = type.detected === "zip";
  const heuristic = isArchive ? null : classifyByHeuristic(filename);
  const quarantined = scan.status === "NOT_SCANNED";

  const { document, version } = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        engagementId: req.engagementId,
        title: filename,
        documentClass: heuristic?.documentClass ?? "UNKNOWN",
        classificationSource: "HEURISTIC",
        classificationConfidence: heuristic?.confidence ?? "UNVERIFIED",
        elementHint: heuristic?.element ?? null,
        status: quarantined ? "QUARANTINED" : heuristic && heuristic.documentClass !== "UNKNOWN" ? "CLASSIFIED" : "RECEIVED",
        sourceArchiveId: req.sourceArchiveId,
      },
    });
    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        originalFilename: filename,
        mimeType: type.mimeType,
        detectedType: type.detected,
        sizeBytes: req.data.length,
        sha256,
        storageKey,
        scanStatus: scan.status,
        scanDetail: scan.detail,
        uploadedById: req.user.id,
      },
    });
    await recordAudit(tx, {
      eventType: AuditEventType.DOCUMENT_UPLOADED,
      organisationId: req.user.organisationId,
      engagementId: req.engagementId,
      userId: req.user.id,
      entityType: "Document",
      entityId: document.id,
      newValue: {
        filename,
        sha256,
        sizeBytes: req.data.length,
        detectedType: type.detected,
        scanStatus: scan.status,
        classification: document.documentClass,
        classificationMatchedOn: heuristic?.matchedOn ?? null,
        sourceArchiveId: req.sourceArchiveId ?? null,
      },
      ipAddress: req.ip,
    });
    return { document, version };
  });

  if (!isArchive) return { kind: "STORED", filename, document, version, quarantined };

  if (depth >= MAX_ARCHIVE_DEPTH) {
    return { kind: "ARCHIVE", filename, document, members: [{ kind: "REJECTED", filename, reason: "Nested archive depth limit reached." }] };
  }
  let entries;
  try {
    entries = await expandZip(req.data, {
      maxEntries: e.MAX_ZIP_ENTRIES,
      maxTotalUncompressedBytes: e.MAX_ZIP_UNCOMPRESSED_BYTES,
      maxCompressionRatio: 200,
    });
  } catch (err) {
    if (err instanceof UnsafeArchiveError) {
      await prisma.document.update({ where: { id: document.id }, data: { status: "FAILED" } });
      return { kind: "ARCHIVE", filename, document, members: [await reject(err.message)] };
    }
    throw err;
  }
  const members: IngestOutcome[] = [];
  for (const entry of entries) {
    members.push(
      await ingestFile({ ...req, filename: entry.filename, data: entry.data, sourceArchiveId: document.id, depth: depth + 1 }),
    );
  }
  await prisma.document.update({ where: { id: document.id }, data: { status: "EXTRACTED" } });
  return { kind: "ARCHIVE", filename, document, members };
}

/** Flatten outcomes (archives expanded) for summaries. */
export function flattenOutcomes(outcomes: IngestOutcome[]): IngestOutcome[] {
  return outcomes.flatMap((o) => (o.kind === "ARCHIVE" ? [o, ...flattenOutcomes(o.members)] : [o]));
}
