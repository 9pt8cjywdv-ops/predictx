import { NextRequest, NextResponse } from "next/server";

// Server-side proxy to the Python engine so the browser never needs its address.
const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8000";
const ALLOWED = new Set(["predictions", "meta", "accuracy", "events", "health"]);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!path?.length || !ALLOWED.has(path[0])) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const target = `${ENGINE_URL}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  try {
    const res = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "The prediction engine is unreachable. No predictions are shown rather than outdated ones." },
      { status: 502 },
    );
  }
}
