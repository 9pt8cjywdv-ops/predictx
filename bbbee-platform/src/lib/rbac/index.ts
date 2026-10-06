import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { DEFAULT_ROLE_PERMISSIONS, type Permission } from "./permissions";

export * from "./permissions";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

const cache = new Map<string, { at: number; perms: Set<string> }>();
const TTL_MS = 30_000;

/** Permissions are configurable per organisation; falls back to defaults if none are stored. */
export async function permissionsFor(organisationId: string, role: Role): Promise<Set<string>> {
  const key = `${organisationId}:${role}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.perms;
  const rows = await prisma.rolePermission.findMany({ where: { organisationId, role }, select: { permission: true } });
  const perms = new Set<string>(rows.length ? rows.map((r) => r.permission) : DEFAULT_ROLE_PERMISSIONS[role]);
  cache.set(key, { at: Date.now(), perms });
  return perms;
}

export function invalidatePermissionCache(): void {
  cache.clear();
}

export interface Principal {
  id: string;
  organisationId: string;
  role: Role;
  name: string;
  email: string;
}

export async function can(user: Principal, permission: Permission): Promise<boolean> {
  return (await permissionsFor(user.organisationId, user.role)).has(permission);
}

export async function requirePermission(user: Principal, permission: Permission): Promise<void> {
  if (!(await can(user, permission))) throw new ForbiddenError();
}
