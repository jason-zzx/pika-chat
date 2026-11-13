import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

/**
 * Resolves the instance operator (the `super_admin` created during setup)
 * whose shared credentials and model preferences guests inherit in demo mode.
 */
export async function resolveOperatorId(): Promise<string> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("demo mode requires a super_admin operator");
  }
  return id;
}
