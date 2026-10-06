import { recordAudit, AuditEventType } from "../audit";
import { prisma } from "../db";
import { DUMMY_HASH, verifyPassword } from "./password";
import { rateLimit } from "./rateLimit";

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; error: "INVALID_CREDENTIALS" | "LOCKED" | "RATE_LIMITED" };

/** Credential check with rate limiting, lockout, constant-ish timing and auditing. */
export async function authenticate(emailRaw: string, password: string, ip: string | null): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!rateLimit(`login:ip:${ip ?? "unknown"}`, 20, 15 * 60_000).allowed || !rateLimit(`login:email:${email}`, 10, 15 * 60_000).allowed) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.isActive) return { ok: false, error: "INVALID_CREDENTIALS" };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, error: "LOCKED" };

  if (!valid) {
    const failures = user.failedLogins + 1;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: failures, lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null },
      });
      await recordAudit(tx, { eventType: AuditEventType.LOGIN_FAILED, organisationId: user.organisationId, userId: user.id, ipAddress: ip, newValue: { failures } });
    });
    return { ok: false, error: failures >= MAX_FAILURES ? "LOCKED" : "INVALID_CREDENTIALS" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await recordAudit(tx, { eventType: AuditEventType.LOGIN, organisationId: user.organisationId, userId: user.id, ipAddress: ip });
  });
  return { ok: true, userId: user.id };
}
