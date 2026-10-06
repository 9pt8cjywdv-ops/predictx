import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { flattenOutcomes, ingestFile } from "@/lib/ingestion/ingest";
import { setScannerForTesting, type MalwareScanner } from "@/lib/ingestion/scan";
import { reclassifyDocument, ValidationError } from "@/lib/overrides";
import { ForbiddenError, NotFoundError } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { getScopedEngagement } from "@/lib/tenancy";
import { makeEngagement, makeOrg, makeUser } from "./factory";

const clean: MalwareScanner = { scan: async () => ({ status: "CLEAN", detail: "test" }) };
const PDF = (s: string) => Buffer.from(`%PDF-1.4\n${s}\n%%EOF`);

describe("tenant isolation", () => {
  it("staff cannot see another organisation's engagements", async () => {
    const [a, b] = [await makeOrg(), await makeOrg()];
    const { engagement } = await makeEngagement(a.id);
    const outsider = await makeUser(b.id, "ADMINISTRATOR");
    await expect(getScopedEngagement(outsider, engagement.id)).rejects.toBeInstanceOf(NotFoundError);
    const insider = await makeUser(a.id, "READ_ONLY_REVIEWER");
    await expect(getScopedEngagement(insider, engagement.id)).resolves.toMatchObject({ id: engagement.id });
  });

  it("client users see only clients explicitly granted to them", async () => {
    const org = await makeOrg();
    const mine = await makeEngagement(org.id);
    const theirs = await makeEngagement(org.id);
    const clientUser = await makeUser(org.id, "CLIENT_USER");
    await prisma.clientUserAccess.create({ data: { userId: clientUser.id, clientId: mine.client.id } });
    await expect(getScopedEngagement(clientUser, mine.engagement.id)).resolves.toBeTruthy();
    await expect(getScopedEngagement(clientUser, theirs.engagement.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("document ingestion", () => {
  let user: Awaited<ReturnType<typeof makeUser>>;
  let engagementId: string;
  beforeAll(async () => {
    setScannerForTesting(clean);
    const org = await makeOrg();
    user = await makeUser(org.id, "VERIFICATION_ANALYST");
    engagementId = (await makeEngagement(org.id)).engagement.id;
  });

  it("stores originals content-addressed, classifies heuristically and audits the upload", async () => {
    const data = PDF("afs");
    const out = await ingestFile({ user, engagementId, filename: "Audited Financial Statements.pdf", data });
    expect(out.kind).toBe("STORED");
    if (out.kind !== "STORED") return;
    expect(out.document).toMatchObject({ documentClass: "FINANCIAL_STATEMENTS", classificationSource: "HEURISTIC", status: "CLASSIFIED" });
    expect(out.version.scanStatus).toBe("CLEAN");
    expect((await storage().get(out.version.storageKey)).equals(data)).toBe(true);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: out.document.id, eventType: "DOCUMENT_UPLOADED" } });
    expect(audit?.newValue).toMatchObject({ sha256: out.version.sha256 });
  });

  it("detects duplicates by hash regardless of filename", async () => {
    const first = await ingestFile({ user, engagementId, filename: "pop.pdf", data: PDF("same") });
    const second = await ingestFile({ user, engagementId, filename: "copy of pop.pdf", data: PDF("same") });
    expect(second.kind).toBe("DUPLICATE");
    if (second.kind === "DUPLICATE" && first.kind === "STORED") expect(second.duplicateOfId).toBe(first.document.id);
  });

  it("expands ZIP packs and links members to the archive", async () => {
    const z = new JSZip();
    z.file("pack/EEA2.pdf", PDF("eea2"));
    z.file("pack/Share register.pdf", PDF("reg"));
    const out = await ingestFile({ user, engagementId, filename: "verification-pack.zip", data: await z.generateAsync({ type: "nodebuffer" }) });
    if (out.kind !== "ARCHIVE") throw new Error(`expected ARCHIVE, got ${out.kind}`);
    const members = flattenOutcomes([out]).filter((o) => o.kind === "STORED");
    expect(members.map((m) => m.kind === "STORED" && m.document.documentClass).sort()).toEqual(["EEA2", "SHARE_REGISTER"]);
    expect(members.every((m) => m.kind === "STORED" && m.document.sourceArchiveId === out.document.id)).toBe(true);
  });

  it("rejects infected files without storing them", async () => {
    setScannerForTesting({ scan: async () => ({ status: "INFECTED", detail: "Eicar-Test-Signature FOUND" }) });
    const before = await prisma.document.count({ where: { engagementId } });
    const out = await ingestFile({ user, engagementId, filename: "invoice.pdf", data: PDF("virus") });
    expect(out).toMatchObject({ kind: "REJECTED" });
    expect(await prisma.document.count({ where: { engagementId } })).toBe(before);
    expect(await prisma.auditEvent.count({ where: { engagementId, eventType: "DOCUMENT_QUARANTINED" } })).toBeGreaterThan(0);
    setScannerForTesting(clean);
  });

  it("quarantines files when no scanner is available", async () => {
    setScannerForTesting({ scan: async () => ({ status: "NOT_SCANNED", detail: "none" }) });
    const out = await ingestFile({ user, engagementId, filename: "Bank statement.pdf", data: PDF("bank") });
    expect(out).toMatchObject({ kind: "STORED", quarantined: true });
    if (out.kind === "STORED") expect(out.document.status).toBe("QUARANTINED");
    setScannerForTesting(clean);
  });

  it("human reclassification preserves the AI/heuristic value in an override and is audited", async () => {
    const out = await ingestFile({ user, engagementId, filename: "scan0001.pdf", data: PDF("unknown") });
    if (out.kind !== "STORED") throw new Error("expected stored");
    await expect(reclassifyDocument(user, out.document.id, "TRUST_DEED", "  ")).rejects.toBeInstanceOf(ValidationError);
    const updated = await reclassifyDocument(user, out.document.id, "TRUST_DEED", "Read the document: it is the trust deed");
    expect(updated).toMatchObject({ documentClass: "TRUST_DEED", classificationSource: "HUMAN", classifiedById: user.id });
    const o = await prisma.override.findFirst({ where: { targetId: out.document.id } });
    expect(o).toMatchObject({ overrideType: "DOCUMENT_CLASSIFICATION", aiValue: { documentClass: "UNKNOWN", source: "HEURISTIC" }, overrideValue: { documentClass: "TRUST_DEED" } });
  });

  it("read-only reviewers cannot reclassify", async () => {
    const out = await ingestFile({ user, engagementId, filename: "scan0002.pdf", data: PDF("x2") });
    if (out.kind !== "STORED") throw new Error("expected stored");
    const ro = await makeUser(user.organisationId, "READ_ONLY_REVIEWER");
    await expect(reclassifyDocument(ro, out.document.id, "MOI", "reason")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
