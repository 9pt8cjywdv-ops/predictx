import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export interface ProvisionHit {
  id: string;
  reference: string;
  heading: string | null;
  snippet: string;
  documentTitle: string;
  rank: number;
}

/**
 * Targeted retrieval for agents and the library UI (PostgreSQL FTS; pgvector
 * semantic retrieval is layered on in Phase 2). Only approved sources are
 * returned to agents unless `includeDrafts` is set for administrators.
 */
export async function searchProvisions(query: string, opts: { element?: string; limit?: number; includeDrafts?: boolean } = {}): Promise<ProvisionHit[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(opts.limit ?? 20, 100);
  const statuses = opts.includeDrafts ? ["DRAFT", "UNDER_REVIEW", "APPROVED", "PUBLISHED", "SUPERSEDED"] : ["APPROVED", "PUBLISHED", "SUPERSEDED"];
  const elementFilter = opts.element ? Prisma.sql`AND p."element"::text = ${opts.element}` : Prisma.empty;
  return prisma.$queryRaw<ProvisionHit[]>`
    SELECT p."id", p."reference", p."heading",
           ts_headline('english', p."text", websearch_to_tsquery('english', ${q}), 'StartSel=⟦,StopSel=⟧,MaxFragments=2,MaxWords=30') AS "snippet",
           d."title" AS "documentTitle",
           ts_rank(to_tsvector('english', coalesce(p."heading", '') || ' ' || coalesce(p."text", '')), websearch_to_tsquery('english', ${q}))::float AS "rank"
    FROM "RegulatoryProvision" p
    JOIN "RegulatoryDocument" d ON d."id" = p."documentId"
    WHERE to_tsvector('english', coalesce(p."heading", '') || ' ' || coalesce(p."text", '')) @@ websearch_to_tsquery('english', ${q})
      AND p."status"::text IN (${Prisma.join(statuses)})
      ${elementFilter}
    ORDER BY "rank" DESC
    LIMIT ${limit}`;
}
