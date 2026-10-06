import { resolveSession, SESSION_COOKIE } from "./auth/session";
import type { Principal } from "./rbac";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function apiUser(req: Request): Promise<Principal> {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const user = await resolveSession(token ? decodeURIComponent(token) : undefined);
  if (!user) throw new HttpError(401, "Unauthenticated");
  return user;
}

/** Map domain errors to HTTP without leaking internals. */
export function apiError(e: unknown): Response {
  const status = (e as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return Response.json({ error: (e as Error).message }, { status });
  }
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
