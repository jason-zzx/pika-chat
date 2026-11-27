import "server-only";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import {
  assistants,
  chatMessages,
  files,
  topics,
  users,
} from "@/server/db/schema";
import { getFileStorage } from "@/server/files/storage";

import { removeUser } from "./user-delete.service";

const db = getDb();
const created: string[] = [];

async function seedUser(role: "super_admin" | "admin" | "user") {
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

async function seedData(userId: string) {
  const assistantId = newId();
  const topicId = newId();
  const fileId = newId();
  const storageKey = `${userId}/${fileId}.txt`;
  await db
    .insert(assistants)
    .values({ id: assistantId, ownerId: userId, name: "a", icon: "x" });
  await db
    .insert(topics)
    .values({ id: topicId, assistantId, title: "t" });
  const messageId = newId();
  await db.insert(chatMessages).values({
    id: messageId,
    groupId: messageId,
    topicId,
    role: "user",
    parts: [{ type: "text", text: "hi" }],
  });
  await getFileStorage().put(storageKey, Buffer.from("blob"));
  await db.insert(files).values({
    id: fileId,
    userId,
    filename: "f.txt",
    mediaType: "text/plain",
    sizeBytes: 4,
    storageKey,
  });
  return { topicId, storageKey };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of created.splice(0)) {
    await db.delete(users).where(eq(users.id, id));
  }
});

async function userExists(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId))).length === 1;
}

describe("removeUser", () => {
  it("lets a super_admin delete an admin along with their data and objects", async () => {
    const actor = await seedUser("super_admin");
    const target = await seedUser("admin");
    const data = await seedData(target.userId);

    await removeUser(target.userId, actor);

    expect(await userExists(target.userId)).toBe(false);
    expect(
      await db.select().from(topics).where(eq(topics.id, data.topicId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.topicId, data.topicId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(files).where(eq(files.userId, target.userId)),
    ).toHaveLength(0);
    await expect(getFileStorage().get(data.storageKey)).rejects.toThrow();
  });

  it("lets an admin delete a user", async () => {
    const actor = await seedUser("admin");
    const target = await seedUser("user");

    await removeUser(target.userId, actor);

    expect(await userExists(target.userId)).toBe(false);
  });

  it("rejects a forbidden target without touching data", async () => {
    const superAdmin = await seedUser("super_admin");
    const admin = await seedUser("admin");
    const data = await seedData(superAdmin.userId);

    await expect(removeUser(superAdmin.userId, admin)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(await userExists(superAdmin.userId)).toBe(true);
    expect((await getFileStorage().get(data.storageKey)).toString()).toBe(
      "blob",
    );
    await getFileStorage().delete(data.storageKey);
  });

  it("404s for an unknown user", async () => {
    const actor = await seedUser("super_admin");

    await expect(removeUser(newId(), actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("keeps the user when an attachment object cannot be deleted", async () => {
    const actor = await seedUser("super_admin");
    const target = await seedUser("user");
    const data = await seedData(target.userId);
    vi.spyOn(getFileStorage(), "delete").mockRejectedValueOnce(
      new Error("storage down"),
    );

    await expect(removeUser(target.userId, actor)).rejects.toMatchObject({
      code: "INTERNAL",
      status: 500,
      messageKey: "auth.userDeleteFailed",
    });
    expect(await userExists(target.userId)).toBe(true);

    await removeUser(target.userId, actor);
    expect(await userExists(target.userId)).toBe(false);
    await expect(getFileStorage().get(data.storageKey)).rejects.toThrow();
  });
});
