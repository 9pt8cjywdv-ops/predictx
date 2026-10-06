import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/health"];

/** Coarse gate only: real session validation happens server-side on every request. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("bbbee_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
