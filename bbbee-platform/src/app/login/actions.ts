"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate } from "@/lib/auth/login";
import { createSession, destroySession, requestMeta } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/session";
import { AuditEventType, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

const MESSAGES = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  LOCKED: "This account is temporarily locked after repeated failed attempts. Try again in 15 minutes.",
  RATE_LIMITED: "Too many sign-in attempts. Please wait and try again.",
} as const;

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: MESSAGES.INVALID_CREDENTIALS };
  const { ip, userAgent } = await requestMeta();
  const result = await authenticate(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) return { error: MESSAGES[result.error] };
  await createSession(result.userId, ip, userAgent);
  redirect("/");
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) {
    await prisma.$transaction((tx) => recordAudit(tx, { eventType: AuditEventType.LOGOUT, organisationId: user.organisationId, userId: user.id }));
  }
  await destroySession();
  redirect("/login");
}
