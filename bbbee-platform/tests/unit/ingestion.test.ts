import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { classifyByHeuristic } from "@/lib/ingestion/classify";
import { checkFileType, sanitizeFilename, sniff } from "@/lib/ingestion/filetype";
import { expandZip, UnsafeArchiveError } from "@/lib/ingestion/zip";
import { contentKey } from "@/lib/storage";
import { canonicalJson, sha256Hex } from "@/lib/hash";

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const limits = { maxEntries: 50, maxTotalUncompressedBytes: 10_000_000, maxCompressionRatio: 200 };

describe("content sniffing", () => {
  it("detects types from magic bytes", () => {
    expect(sniff(PDF)).toBe("pdf");
    expect(sniff(PNG)).toBe("png");
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniff(Buffer.from("a,b\n1,2\n"))).toBe("csv");
    expect(sniff(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe("unknown"); // PE executable
  });
  it("rejects content that does not match the extension", () => {
    expect(checkFileType("payroll.pdf", Buffer.from("a,b\n1,2")).ok).toBe(false);
    expect(checkFileType("invoice.pdf", Buffer.from([0x4d, 0x5a, 0x90, 0x00])).ok).toBe(false);
  });
  it("rejects disallowed extensions", () => {
    expect(checkFileType("tool.exe", PDF)).toMatchObject({ ok: false });
    expect(checkFileType("noext", PDF)).toMatchObject({ ok: false });
  });
  it("accepts matching content", () => {
    expect(checkFileType("AFS 2026.PDF", PDF)).toMatchObject({ ok: true, detected: "pdf", mimeType: "application/pdf" });
  });
  it("identifies OOXML by package parts", async () => {
    const z = new JSZip();
    z.file("xl/workbook.xml", "<workbook/>");
    const buf = await z.generateAsync({ type: "nodebuffer" });
    expect(checkFileType("tb.xlsx", buf)).toMatchObject({ ok: true, detected: "xlsx" });
  });
  it("sanitises client-supplied filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\temp\\evil\u0000.pdf")).toBe("evil.pdf");
    expect(sanitizeFilename("")).toBe("file");
  });
});

describe("heuristic classification", () => {
  it.each([
    ["EEA4 Income Differentials 2025.pdf", "EEA4"],
    ["EEA2_2025.pdf", "EEA2"],
    ["Share Register.xlsx", "SHARE_REGISTER"],
    ["CIPC CoR14.3.pdf", "CIPC"],
    ["Audited Financial Statements FY26.pdf", "FINANCIAL_STATEMENTS"],
    ["Supplier listing FY2026.xlsx", "SUPPLIER_LISTING"],
    ["Acme BBBEE certificate.pdf", "SUPPLIER_CERTIFICATE"],
    ["Sworn affidavit EME.pdf", "AFFIDAVIT"],
    ["Learnership agreement - J Doe.pdf", "LEARNERSHIP_AGREEMENT"],
    ["Proof of payment 123.pdf", "PROOF_OF_PAYMENT"],
    ["Donation to NPO.pdf", "SED_DOCUMENTATION"],
    ["random scan 0042.jpg", "UNKNOWN"],
  ])("%s → %s", (name, expected) => {
    const r = classifyByHeuristic(name);
    expect(r.documentClass).toBe(expected);
    expect(r.confidence).toBe(expected === "UNKNOWN" ? "UNVERIFIED" : "LOW");
  });
});

describe("zip expansion", () => {
  it("expands entries and ignores OS metadata", async () => {
    const z = new JSZip();
    z.file("pack/afs.pdf", PDF);
    z.file("__MACOSX/pack/._afs.pdf", "junk");
    z.file("pack/.DS_Store", "junk");
    const out = await expandZip(await z.generateAsync({ type: "nodebuffer" }), limits);
    expect(out.map((e) => e.filename)).toEqual(["afs.pdf"]);
  });
  it("enforces the entry limit", async () => {
    const z = new JSZip();
    for (let i = 0; i < 5; i++) z.file(`f${i}.csv`, "a,b");
    await expect(expandZip(await z.generateAsync({ type: "nodebuffer" }), { ...limits, maxEntries: 3 })).rejects.toBeInstanceOf(UnsafeArchiveError);
  });
  it("detects zip bombs by expansion ratio", async () => {
    const z = new JSZip();
    z.file("zeros.csv", Buffer.alloc(5_000_000, 0x30));
    const buf = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    await expect(expandZip(buf, limits)).rejects.toThrow(/zip bomb|permitted size/);
  });
  it("rejects corrupt archives safely", async () => {
    await expect(expandZip(Buffer.from("PK\u0003\u0004 garbage"), limits)).rejects.toBeInstanceOf(UnsafeArchiveError);
  });
});

describe("hashing and content addressing", () => {
  it("hashes deterministically and canonicalises JSON key order", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("builds safe content-addressed keys", () => {
    const h = sha256Hex("x");
    expect(contentKey("documents", h)).toBe(`documents/${h.slice(0, 2)}/${h.slice(2, 4)}/${h}`);
    expect(() => contentKey("documents", "../../etc")).toThrow();
    expect(() => contentKey("../x", h)).toThrow();
  });
});
