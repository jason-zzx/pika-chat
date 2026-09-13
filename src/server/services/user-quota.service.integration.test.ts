import "server-only";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { BYTES_PER_MB } from "@/lib/files/constants";
import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

import { getUserQuota, updateUserQuota } from "./user-quota.service";

const db = getDb();
const created: string[] = [];

type SeededRole = "super_admin" | "admin" | "user";

async function seedUser(role: SeededRole) {
  const id = newId();
  await db.insert(users).values({
    id,
    name: `${role}-${id}`,
    email: `${id}@example.com`,
    username: id,
    role,
  });
  created.push(id);
  return { userId: id, role } as const;
}

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(users).where(eq(users.id, id));
  }
});

/**
 * The route test mocks the service, and Better Auth does not know this custom
 * column — so the target-hierarchy guard (`canAdminister(..., "set-quota")`)
 * is only exercised end to end here. The service is the security boundary.
 */
describe("updateUserQuota target hierarchy", () => {
  it("lets an admin set a regular user's override", async () => {
    const admin = await seedUser("admin");
    const target = await seedUser("user");

    const result = await updateUserQuota(target.userId, 500, admin);

    expect(result).toEqual({
      userId: target.userId,
      quotaBytes: 500 * BYTES_PER_MB,
    });
    await expect(getUserQuota(target.userId)).resolves.toEqual({
      userId: target.userId,
      quotaBytes: 500 * BYTES_PER_MB,
    });
  });

  it("rejects an admin targeting another admin", async () => {
    const admin = await seedUser("admin");
    const target = await seedUser("admin");

    await expect(
      updateUserQuota(target.userId, 500, admin),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      messageKey: "auth.targetNotAllowed",
    });
    await expect(getUserQuota(target.userId)).resolves.toEqual({
      userId: target.userId,
      quotaBytes: null,
    });
  });

  it("rejects an admin targeting a super_admin", async () => {
    const admin = await seedUser("admin");
    const target = await seedUser("super_admin");

    await expect(
      updateUserQuota(target.userId, 1, admin),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      messageKey: "auth.targetNotAllowed",
    });
    await expect(getUserQuota(target.userId)).resolves.toEqual({
      userId: target.userId,
      quotaBytes: null,
    });
  });

  it("lets a super_admin set an admin's override", async () => {
    const actor = await seedUser("super_admin");
    const target = await seedUser("admin");

    const result = await updateUserQuota(target.userId, 10, actor);

    expect(result.quotaBytes).toBe(10 * BYTES_PER_MB);
  });

  it("rejects a regular user actor", async () => {
    const actor = await seedUser("user");
    const target = await seedUser("user");

    await expect(
      updateUserQuota(target.userId, 1, actor),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("clears an override with null", async () => {
    const admin = await seedUser("admin");
    const target = await seedUser("user");

    await updateUserQuota(target.userId, 42, admin);
    const cleared = await updateUserQuota(target.userId, null, admin);

    expect(cleared.quotaBytes).toBeNull();
    await expect(getUserQuota(target.userId)).resolves.toEqual({
      userId: target.userId,
      quotaBytes: null,
    });
  });

  it("404s for a missing target", async () => {
    const admin = await seedUser("admin");

    await expect(updateUserQuota(newId(), 1, admin)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      messageKey: "auth.userNotFound",
    });
  });
});
