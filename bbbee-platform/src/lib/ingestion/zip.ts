import JSZip from "jszip";
import { sanitizeFilename } from "./filetype";

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
}

export interface ZipEntry {
  path: string;
  filename: string;
  data: Buffer;
}

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeArchiveError";
  }
}

const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

/**
 * Expand a verification pack with zip-bomb and path-traversal protection.
 * Nested archives are returned as entries (and expanded by the caller, depth-limited).
 */
export async function expandZip(buf: Buffer, limits: ZipLimits): Promise<ZipEntry[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: true });
  } catch (e) {
    throw new UnsafeArchiveError(`Corrupt or unreadable archive: ${(e as Error).message}`);
  }
  const files = Object.values(zip.files).filter((f) => !f.dir && !IGNORED.some((r) => r.test(f.name)));
  if (files.length > limits.maxEntries) throw new UnsafeArchiveError(`Archive has ${files.length} entries (limit ${limits.maxEntries}).`);

  const out: ZipEntry[] = [];
  let total = 0;
  for (const f of files) {
    // JSZip sanitises names on load; check the original name so traversal attempts are surfaced, not silently rewritten.
    const original = (f as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? f.name;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(original) || original.startsWith("/") || original.startsWith("\\") || /^[A-Za-z]:/.test(original)) {
      throw new UnsafeArchiveError(`Unsafe path in archive: ${original}`);
    }
    const data = await f.async("nodebuffer");
    total += data.length;
    if (total > limits.maxTotalUncompressedBytes) throw new UnsafeArchiveError("Archive expands beyond the permitted size.");
    out.push({ path: f.name, filename: sanitizeFilename(f.name), data });
  }
  if (buf.length > 0 && total / buf.length > limits.maxCompressionRatio) {
    throw new UnsafeArchiveError("Archive compression ratio is suspicious (possible zip bomb).");
  }
  return out;
}
