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
  updateUserPayload,
} from "@/lib/auth-hierarchy";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { logger } from "@/server/logger";

type HookAction = AdminAction | "update-user";

const PATH_ACTION = {
  "/admin/set-role": "set-role",
  "/admin/ban-user": "ban",
  "/admin/unban-user": "unban",
  "/admin/set-user-password": "set-user-password",
  "/admin/create-user": "create-user",
  "/admin/update-user": "update-user",
} as const satisfies Record<string, HookAction>;

function hierarchyAction(path: string | undefined): HookAction | undefined {
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

function rejectUpdateUser(actor: Actor, target: Actor, body: unknown): void {
  const data = updateUserPayload(body);
  if (!data) {
    return;
  }

  if ("role" in data) {
    if (!canAdminister(actor, target, "set-role", data.role)) {
      logger.info(
        {
          userId: actor.userId,
          action: "update-user",
          targetUserId: target.userId,
        },
        "admin action rejected by role hierarchy",
      );
      forbidden();
    }
  }

  if ("banned" in data || "banReason" in data || "banExpires" in data) {
    const banAction = data.banned === false ? "unban" : "ban";
    if (!canAdminister(actor, target, banAction)) {
      logger.info(
        {
          userId: actor.userId,
          action: "update-user",
          targetUserId: target.userId,
        },
        "admin action rejected by role hierarchy",
      );
      forbidden();
    }
  }
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

            if (action === "update-user") {
              rejectUpdateUser(actor, target, ctx.body);
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
