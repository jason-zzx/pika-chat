import "server-only";

import {
  type Actor,
  isStaffRole,
  parseActorRole,
} from "@/lib/auth-hierarchy";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";

export type { Actor } from "@/lib/auth-hierarchy";

export type ResolvedActor = Actor & { name: string };

function isBanned(user: Record<string, unknown>): boolean {
  return user.banned === true;
}

function actorName(user: { username?: unknown; email?: unknown }): string {
  if (typeof user.username === "string" && user.username.length > 0) {
    return user.username;
  }
  if (typeof user.email === "string" && user.email.length > 0) {
    return user.email;
  }
  return "Account";
}

export async function resolveActor(
  headers: Headers,
): Promise<ResolvedActor | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return null;
  }
  if (isBanned(session.user)) {
    return null;
  }
  return {
    userId: session.user.id,
    role: parseActorRole(session.user.role),
    name: actorName(session.user),
  };
}

export async function requireActor(headers: Headers): Promise<ResolvedActor> {
  const actor = await resolveActor(headers);
  if (!actor) {
    throw new AppError("UNAUTHENTICATED", 401, "Authentication required");
  }
  return actor;
}

export async function requireAdmin(headers: Headers): Promise<ResolvedActor> {
  const actor = await requireActor(headers);
  if (!isStaffRole(actor.role)) {
    throw new AppError("FORBIDDEN", 403, "Admin access required");
  }
  return actor;
}
