import "server-only";

import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { eq } from "drizzle-orm";

import {
  type AdminAction,
  type Actor,
  canAdminister,
  parseActorRole,
  requestedRoleFromBody,
} from "@/lib/auth-hierarchy";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { logger } from "@/server/logger";

const PATH_ACTION = {
  "/admin/set-role": "set-role",
  "/admin/ban-user": "ban",
  "/admin/unban-user": "unban",
  "/admin/set-user-password": "set-user-password",
  "/admin/create-user": "create-user",
} as const satisfies Record<string, AdminAction>;

function hierarchyAction(path: string | undefined): AdminAction | undefined {
  if (!path || !(path in PATH_ACTION)) {
    return undefined;
  }
  return PATH_ACTION[path as keyof typeof PATH_ACTION];
}

function readBodyUserId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("userId" in body)) {
    return undefined;
  }
  const userId = body.userId;
  if (typeof userId === "string" && userId.length > 0) {
    return userId;
  }
  if (typeof userId === "number" && Number.isFinite(userId)) {
    return String(userId);
  }
  return undefined;
}

function forbidden(): never {
  throw APIError.from("FORBIDDEN", {
    code: "FORBIDDEN",
    message: "This action is not allowed",
  });
}

async function loadTarget(userId: string): Promise<Actor | null> {
  const rows = await getDb()
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { userId: row.id, role: parseActorRole(row.role) };
}

export function roleHierarchy() {
  return {
    id: "role-hierarchy",
    hooks: {
      before: [
        {
          matcher(context: { path?: string }) {
            return hierarchyAction(context.path) !== undefined;
          },
          handler: createAuthMiddleware(async (ctx) => {
            const action = hierarchyAction(ctx.path);
            if (!action) {
              return;
            }

            const session = await getSessionFromCtx(ctx);
            if (!session) {
              return;
            }

            const actor: Actor = {
              userId: session.user.id,
              role: parseActorRole(session.user.role),
            };

            if (action === "create-user") {
              if (
                !canAdminister(
                  actor,
                  null,
                  action,
                  requestedRoleFromBody(ctx.body),
                )
              ) {
                logger.info(
                  { userId: actor.userId, action },
                  "admin action rejected by role hierarchy",
                );
                forbidden();
              }
              return;
            }

            const targetId = readBodyUserId(ctx.body);
            if (!targetId) {
              return;
            }

            const target = await loadTarget(targetId);
            if (!target) {
              return;
            }

            if (
              !canAdminister(
                actor,
                target,
                action,
                requestedRoleFromBody(ctx.body),
              )
            ) {
              logger.info(
                { userId: actor.userId, action, targetUserId: targetId },
                "admin action rejected by role hierarchy",
              );
              forbidden();
            }
          }),
        },
      ],
    },
  };
}
