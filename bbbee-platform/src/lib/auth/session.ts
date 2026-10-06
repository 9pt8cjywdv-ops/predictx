import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "../db";
import { env } from "../env";
import { sha256Hex } from "../hash";
import type { Principal } from "../rbac";

export const SESSION_COOKIE = "bbbee_session";
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string, ip: string | null, userAgent: string | null): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
  await prisma.session.create({ data: { userId, tokenHash: sha256Hex(token), ipAddress: ip, userAgent, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function resolveSession(token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) return null;
  if (Date.now() - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const u = session.user;
  return { id: u.id, organisationId: u.organisationId, role: u.role, name: u.name, email: u.email };
}

export async function getCurrentUser(): Promise<Principal | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

/** For server components/pages: redirect to login if unauthenticated. */
export async function requireUser(): Promise<Principal> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({ where: { tokenHash: sha256Hex(token) }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ip, userAgent: h.get("user-agent") };
}

/** Page guard: unauthorised users get a 404 rather than an error page (no existence leak). */
export async function requirePagePermission(user: Principal, permission: import("../rbac").Permission): Promise<void> {
  const { can } = await import("../rbac");
  if (!(await can(user, permission))) notFound();
}
