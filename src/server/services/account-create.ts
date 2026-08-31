import "server-only";

import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { isUniqueViolation } from "@/server/db/unique-violation";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

const CONFLICT_CODES = new Set([
  "USERNAME_IS_ALREADY_TAKEN",
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
]);

function errorCode(error: unknown): string | undefined {
  if (!isAPIError(error)) {
    return undefined;
  }
  const body = error.body;
  if (typeof body === "object" && body !== null && "code" in body) {
    const code = body.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export async function assertUsernameAvailable(username: string): Promise<void> {
  const normalized = username.toLowerCase();
  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, normalized))
    .limit(1);
  if (existing[0]) {
    throw new AppError("CONFLICT", 409, "Username is already taken");
  }
}

export function throwIfAccountCreateFailed(error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }

  const code = errorCode(error);
  if (code && CONFLICT_CODES.has(code)) {
    throw new AppError("CONFLICT", 409, "Username or email is already taken");
  }
  if (isUniqueViolation(error)) {
    throw new AppError("CONFLICT", 409, "Username or email is already taken");
  }

  logger.error({ err: error }, "account create failed");
  throw new AppError("INTERNAL", 500, "Unable to create account");
}
