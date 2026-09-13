export type ActorRole = "super_admin" | "admin" | "user";

export type Actor = {
  userId: string;
  role: ActorRole;
};

export type AdminAction =
  | "set-role"
  | "ban"
  | "unban"
  | "set-user-password"
  | "set-quota"
  | "create-user";

export function isStaffRole(role: ActorRole): boolean {
  return role === "super_admin" || role === "admin";
}

function roleParts(role: unknown): string[] {
  if (typeof role === "string") {
    return role.split(",").map((part) => part.trim());
  }
  if (Array.isArray(role)) {
    return role.flatMap((item) =>
      typeof item === "string" ? item.split(",").map((part) => part.trim()) : [],
    );
  }
  return [];
}

export function parseActorRole(role: unknown): ActorRole {
  const parts = roleParts(role);
  if (parts.includes("super_admin")) {
    return "super_admin";
  }
  if (parts.includes("admin")) {
    return "admin";
  }
  return "user";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Better Auth's createUser reads `body.role ?? body.data.role`.
 * Matching that here is what closes the `data.role: "super_admin"` hole.
 */
export function requestedRoleFromBody(body: unknown): unknown {
  if (!isRecord(body)) {
    return undefined;
  }
  if (body.role != null) {
    return body.role;
  }
  if (isRecord(body.data) && "role" in body.data) {
    return body.data.role;
  }
  return undefined;
}

export function updateUserPayload(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.data)) {
    return null;
  }
  return body.data;
}

export function canAdminister(
  actor: Actor,
  target: Actor | null,
  action: AdminAction,
  requestedRole?: unknown,
): boolean {
  if (!isStaffRole(actor.role)) {
    return false;
  }
  if (
    requestedRole !== undefined &&
    parseActorRole(requestedRole) === "super_admin"
  ) {
    return false;
  }
  if (action === "create-user") {
    return true;
  }
  if (!target) {
    return false;
  }
  if (target.role === "super_admin") {
    return false;
  }
  if (action === "set-role" && actor.userId === target.userId) {
    return false;
  }
  if (actor.role === "admin") {
    return target.role === "user";
  }
  return target.role === "admin" || target.role === "user";
}
