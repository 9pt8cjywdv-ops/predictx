/**
 * Content sniffing. The declared extension is never trusted on its own: the
 * magic bytes must agree, otherwise the upload is rejected.
 */
export type DetectedType = "pdf" | "xlsx" | "docx" | "zip" | "xls" | "doc" | "csv" | "jpeg" | "png" | "unknown";

export const ALLOWED_EXTENSIONS: Record<string, DetectedType[]> = {
  pdf: ["pdf"],
  xlsx: ["xlsx", "zip"],
  xlsm: ["xlsx", "zip"],
  docx: ["docx", "zip"],
  xls: ["xls"],
  doc: ["doc"],
  csv: ["csv"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  png: ["png"],
  zip: ["zip", "xlsx", "docx"],
};

const MIME: Record<DetectedType, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
  csv: "text/csv",
  jpeg: "image/jpeg",
  png: "image/png",
  unknown: "application/octet-stream",
};

export function mimeFor(t: DetectedType): string {
  return MIME[t];
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

export function sniff(buf: Buffer): DetectedType {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "xls"; // OLE2 (xls/doc)
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString("latin1");
    if (head.includes("xl/")) return "xlsx";
    if (head.includes("word/")) return "docx";
    return "zip";
  }
  if (looksLikeText(buf)) return "csv";
  return "unknown";
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.length === 0) return false;
  let printable = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  }
  return printable / sample.length > 0.95;
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  return m ? m[1]!.toLowerCase() : "";
}

export interface TypeCheck {
  ok: boolean;
  detected: DetectedType;
  mimeType: string;
  reason?: string;
}

export function checkFileType(filename: string, buf: Buffer): TypeCheck {
  const ext = extensionOf(filename);
  const detected = sniff(buf);
  const allowed = ALLOWED_EXTENSIONS[ext];
  if (!allowed) return { ok: false, detected, mimeType: mimeFor(detected), reason: `File type .${ext || "(none)"} is not accepted.` };
  // OLE2 covers both .xls and .doc.
  const effective: DetectedType = detected === "xls" && ext === "doc" ? "doc" : detected;
  if (!allowed.includes(effective)) {
    return { ok: false, detected, mimeType: mimeFor(detected), reason: `Content does not match .${ext} (detected ${detected}).` };
  }
  return { ok: true, detected: effective, mimeType: mimeFor(effective) };
}

/** Strip directory components and control characters from a client-supplied name. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "file").slice(0, 255);
}
