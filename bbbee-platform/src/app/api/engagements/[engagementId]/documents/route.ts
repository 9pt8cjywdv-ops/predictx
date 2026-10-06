import { apiError, apiUser, HttpError } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rateLimit";
import { flattenOutcomes, ingestFile, type IngestOutcome } from "@/lib/ingestion/ingest";
import { Permission, requirePermission } from "@/lib/rbac";
import { getScopedEngagement } from "@/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_REQUEST = 200;

function summarise(o: IngestOutcome) {
  switch (o.kind) {
    case "STORED":
      return { filename: o.filename, outcome: o.quarantined ? "QUARANTINED" : "STORED", documentId: o.document.id, documentClass: o.document.documentClass };
    case "DUPLICATE":
      return { filename: o.filename, outcome: "DUPLICATE", documentId: o.document.id, duplicateOfId: o.duplicateOfId };
    case "ARCHIVE":
      return { filename: o.filename, outcome: "ARCHIVE_EXPANDED", documentId: o.document.id, members: o.members.length };
    case "REJECTED":
      return { filename: o.filename, outcome: "REJECTED", reason: o.reason };
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  try {
    const user = await apiUser(req);
    await requirePermission(user, Permission.DOCUMENT_UPLOAD);
    const { engagementId } = await params;
    const engagement = await getScopedEngagement(user, engagementId);
    if (["APPROVED", "CLOSED"].includes(engagement.status)) throw new HttpError(409, "Engagement is closed to new evidence.");
    if (!rateLimit(`upload:${user.id}`, 60, 60_000).allowed) throw new HttpError(429, "Upload rate limit exceeded.");

    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new HttpError(400, "No files supplied.");
    if (files.length > MAX_FILES_PER_REQUEST) throw new HttpError(400, `At most ${MAX_FILES_PER_REQUEST} files per request; use a ZIP pack for more.`);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const outcomes: IngestOutcome[] = [];
    for (const file of files) {
      outcomes.push(await ingestFile({ user, engagementId: engagement.id, filename: file.name, data: Buffer.from(await file.arrayBuffer()), ip }));
    }
    const flat = flattenOutcomes(outcomes);
    return Response.json({
      results: flat.map(summarise),
      totals: {
        stored: flat.filter((o) => o.kind === "STORED").length,
        duplicates: flat.filter((o) => o.kind === "DUPLICATE").length,
        rejected: flat.filter((o) => o.kind === "REJECTED").length,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
