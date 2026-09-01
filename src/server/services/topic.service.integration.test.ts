import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";
import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  otherAdminCredentials,
  postSetup,
  userCredentials,
} from "@/server/auth/auth-test-helpers";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  assistants,
  providerConfigs,
  providerModels,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import { createAssistant } from "@/server/services/assistant.service";
import {
  createTopic,
  deleteTopic,
  findTopicForActor,
  renameTopic,
} from "@/server/services/topic.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(providerModels);
  await db.delete(providerConfigs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
  await db
    .update(appSettings)
    .set({ allowRegistration: false, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

async function adminCreateUser(
  cookie: string,
  input: {
    username: string;
    email: string;
    password: string;
    role: "admin" | "user";
  },
): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/admin/create-user", {
      cookie,
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        role: input.role,
        data: { username: input.username },
      },
    }),
  );
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await authPost(
    jsonRequest("/api/auth/sign-in/email", { body: { email, password } }),
  );
  expect(response.status).toBe(200);
  return cookiesFrom(response);
}

async function actorFromCookie(cookie: string) {
  return requireActor(jsonRequest("/api/topics", { cookie }).headers);
}

async function seedActors() {
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);

  const createdMember = await adminCreateUser(superCookie, {
    ...userCredentials,
    role: "user",
  });
  expect(createdMember.status).toBe(200);
  const createdOtherAdmin = await adminCreateUser(superCookie, {
    ...otherAdminCredentials,
    role: "admin",
  });
  expect(createdOtherAdmin.status).toBe(200);

  const userCookie = await signIn(
    userCredentials.email,
    userCredentials.password,
  );
  const otherAdminCookie = await signIn(
    otherAdminCredentials.email,
    otherAdminCredentials.password,
  );

  return {
    userActor: await actorFromCookie(userCookie),
    otherAdminActor: await actorFromCookie(otherAdminCookie),
  };
}

describe("topic.service", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("creates a topic with the default title, renames, and deletes it", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const created = await createTopic(
      { assistantId: assistant.id },
      userActor,
    );
    expect(created.title).toBe(DEFAULT_TOPIC_TITLE);

    const renamed = await renameTopic(
      created.id,
      { title: "Planning" },
      userActor,
    );
    expect(renamed.title).toBe("Planning");

    await deleteTopic(created.id, userActor);
    await expect(
      renameTopic(created.id, { title: "Gone" }, userActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 404 when creating under an assistant the actor does not own", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const theirs = await createAssistant(
      { name: "Theirs", icon: "🔒" },
      otherAdminActor,
    );
    await expect(
      createTopic({ assistantId: theirs.id }, userActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const leftover = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.assistantId, theirs.id));
    expect(leftover).toEqual([]);
  });

  it("returns 404 on rename, delete, and read for another user's topic", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const topic = await createTopic({ assistantId: assistant.id }, userActor);

    await expect(
      renameTopic(topic.id, { title: "Stolen" }, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteTopic(topic.id, otherAdminActor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await findTopicForActor(topic.id, otherAdminActor)).toBeNull();
    expect(await findTopicForActor(topic.id, userActor)).toMatchObject({
      id: topic.id,
      title: DEFAULT_TOPIC_TITLE,
    });
  });
});
