import { apiError, apiUser, HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { Permission, requirePermission } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { getScopedEngagement } from "@/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stream an original document. Always served as an attachment with its sniffed type. */
export async function GET(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const user = await apiUser(req);
    await requirePermission(user, Permission.ENGAGEMENT_VIEW);
    const { versionId } = await params;
    const version = await prisma.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
    if (!version) throw new HttpError(404, "Not found.");
    await getScopedEngagement(user, version.document.engagementId);
    if (version.scanStatus === "INFECTED") throw new HttpError(403, "File is blocked.");
    const data = await storage().get(version.storageKey);
    const inline = new URL(req.url).searchParams.get("inline") === "1" && ["application/pdf", "image/png", "image/jpeg"].includes(version.mimeType);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": version.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.originalFilename)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
