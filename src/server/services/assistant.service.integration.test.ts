import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
} from "@/lib/schemas/assistant";
import { requireActor } from "@/server/auth/actor";
import {
  adminCredentials,
  jsonRequest,
  otherAdminCredentials,
  postSetup,
  userCredentials,
  cookiesFrom,
  authPost,
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
import {
  createAssistant,
  deleteAssistant,
  listAssistantTree,
  updateAssistant,
} from "@/server/services/assistant.service";
import { createTopic } from "@/server/services/topic.service";
import {
  addProviderModel,
  createProviderConfig,
} from "@/server/services/provider.service";
import { AppError } from "@/server/errors";

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
  return requireActor(jsonRequest("/api/assistants", { cookie }).headers);
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
    superActor: await actorFromCookie(superCookie),
    userActor: await actorFromCookie(userCookie),
    otherAdminActor: await actorFromCookie(otherAdminCookie),
  };
}

describe("assistant.service", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("lets the owner create, list, update, and delete, and 404s for another user", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const created = await createAssistant(
      { name: "Work", icon: "💼", systemPrompt: "Be brief" },
      userActor,
    );
    expect(created.name).toBe("Work");
    expect(created.icon).toBe("💼");
    expect(created.systemPrompt).toBe("Be brief");
    expect(created.topics).toEqual([]);

    const listed = await listAssistantTree(userActor);
    expect(listed.assistants.map((row) => row.id)).toContain(created.id);

    const updated = await updateAssistant(
      created.id,
      { name: "Lab", systemPrompt: null },
      userActor,
    );
    expect(updated.name).toBe("Lab");
    expect(updated.systemPrompt).toBeNull();

    await expect(
      updateAssistant(created.id, { name: "Hijack" }, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      deleteAssistant(created.id, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const second = await createAssistant(
      { name: "Spare", icon: "📁" },
      userActor,
    );
    await deleteAssistant(created.id, userActor);
    const after = await listAssistantTree(userActor);
    expect(after.assistants.map((row) => row.id)).toEqual([second.id]);
  });

  it("seeds exactly one assistant on the first empty list and does not duplicate", async () => {
    const { userActor } = await seedActors();
    const first = await listAssistantTree(userActor);
    expect(first.assistants).toHaveLength(1);
    const seeded = first.assistants[0];
    expect(seeded?.name).toBe(DEFAULT_ASSISTANT_NAME);
    expect(seeded?.icon).toBe(DEFAULT_ASSISTANT_ICON);
    expect(seeded?.systemPrompt).toBeNull();
    expect(seeded?.defaultProviderConfigId).toBeNull();
    expect(seeded?.defaultModelId).toBeNull();

    const second = await listAssistantTree(userActor);
    expect(second.assistants).toHaveLength(1);
    expect(second.assistants[0]?.id).toBe(seeded?.id);

    const rows = await db
      .select({ id: assistants.id })
      .from(assistants)
      .where(eq(assistants.ownerId, userActor.userId));
    expect(rows).toHaveLength(1);
  });

  it("converges concurrent first-list calls onto one seeded row", async () => {
    const { userActor } = await seedActors();
    const [left, right] = await Promise.all([
      listAssistantTree(userActor),
      listAssistantTree(userActor),
    ]);
    expect(left.assistants).toHaveLength(1);
    expect(right.assistants).toHaveLength(1);
    expect(left.assistants[0]?.id).toBe(right.assistants[0]?.id);

    const rows = await db
      .select({ id: assistants.id })
      .from(assistants)
      .where(eq(assistants.ownerId, userActor.userId));
    expect(rows).toHaveLength(1);
  });

  it("returns 409 when creating a second assistant with an existing name", async () => {
    const { userActor } = await seedActors();
    await createAssistant({ name: "Dup", icon: "✨" }, userActor);
    await expect(
      createAssistant({ name: "Dup", icon: "📁" }, userActor),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("saves with no default model and with a resolved available model", async () => {
    const { userActor } = await seedActors();
    const bare = await createAssistant(
      { name: "Bare", icon: "✨" },
      userActor,
    );
    expect(bare.defaultProviderConfigId).toBeNull();
    expect(bare.defaultModelId).toBeNull();

    const config = await createProviderConfig(
      {
        name: "byok",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
        visibility: "private",
      },
      userActor,
    );
    await addProviderModel(config.id, { modelId: "gpt-4o" }, userActor);

    const withModel = await createAssistant(
      {
        name: "Pinned",
        icon: "🤖",
        defaultProviderConfigId: config.id,
        defaultModelId: "gpt-4o",
      },
      userActor,
    );
    expect(withModel.defaultProviderConfigId).toBe(config.id);
    expect(withModel.defaultModelId).toBe("gpt-4o");

    const cleared = await updateAssistant(
      withModel.id,
      { defaultProviderConfigId: null, defaultModelId: null },
      userActor,
    );
    expect(cleared.defaultProviderConfigId).toBeNull();
    expect(cleared.defaultModelId).toBeNull();
  });

  it("rejects a default model that is not in the available set", async () => {
    const { userActor } = await seedActors();
    await expect(
      createAssistant(
        {
          name: "Bad pin",
          icon: "🤖",
          defaultProviderConfigId: "missing",
          defaultModelId: "nope",
        },
        userActor,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("deletes an assistant's topics when the assistant is deleted", async () => {
    const { userActor } = await seedActors();
    const primary = await createAssistant(
      { name: "Primary", icon: "1️⃣" },
      userActor,
    );
    const extra = await createAssistant(
      { name: "Extra", icon: "2️⃣" },
      userActor,
    );
    const topic = await createTopic({ assistantId: extra.id }, userActor);
    await deleteAssistant(extra.id, userActor);

    const leftover = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect(leftover).toEqual([]);
    const tree = await listAssistantTree(userActor);
    expect(tree.assistants.map((row) => row.id)).toEqual([primary.id]);
  });

  it("refuses to delete the last assistant and leaves its topics intact", async () => {
    const { userActor } = await seedActors();
    const only = await createAssistant(
      { name: "Only", icon: "🔒" },
      userActor,
    );
    const topic = await createTopic({ assistantId: only.id }, userActor);

    await expect(deleteAssistant(only.id, userActor)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    const still = await listAssistantTree(userActor);
    expect(still.assistants).toHaveLength(1);
    expect(still.assistants[0]?.topics.map((row) => row.id)).toEqual([
      topic.id,
    ]);

    const second = await createAssistant(
      { name: "Second", icon: "📁" },
      userActor,
    );
    await deleteAssistant(only.id, userActor);
    await expect(deleteAssistant(second.id, userActor)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("leaves at least one assistant when two concurrent deletes race", async () => {
    const { userActor } = await seedActors();
    const first = await createAssistant(
      { name: "Alpha", icon: "🅰️" },
      userActor,
    );
    const second = await createAssistant(
      { name: "Beta", icon: "🅱️" },
      userActor,
    );

    const results = await Promise.allSettled([
      deleteAssistant(first.id, userActor),
      deleteAssistant(second.id, userActor),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failure = rejected[0];
    expect(failure?.status).toBe("rejected");
    if (failure?.status === "rejected") {
      expect(failure.reason).toBeInstanceOf(AppError);
      expect(failure.reason).toMatchObject({ code: "CONFLICT", status: 409 });
    }

    const remaining = await listAssistantTree(userActor);
    expect(remaining.assistants).toHaveLength(1);
  });
});
