import "server-only";

import {
  type Actor,
  isStaffRole,
  parseActorRole,
} from "@/lib/auth-hierarchy";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";

export type { Actor } from "@/lib/auth-hierarchy";

function isBanned(user: Record<string, unknown>): boolean {
  return user.banned === true;
}

export async function resolveActor(headers: Headers): Promise<Actor | null> {
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
  };
}

export async function requireActor(headers: Headers): Promise<Actor> {
  const actor = await resolveActor(headers);
  if (!actor) {
    throw new AppError("UNAUTHENTICATED", 401, "Authentication required");
  }
  return actor;
}

export async function requireAdmin(headers: Headers): Promise<Actor> {
  const actor = await requireActor(headers);
  if (!isStaffRole(actor.role)) {
    throw new AppError("FORBIDDEN", 403, "Admin access required");
  }
  return actor;
}
