import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/auth-hierarchy";
import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import { providerConfigs, providerModels, users } from "@/server/db/schema";
import {
  addProviderModel,
  createProviderConfig,
} from "@/server/services/provider.service";

import {
  getModelPreferences,
  resolveModelPreference,
  updateModelPreferences,
} from "./model-preferences.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(providerModels);
  await db.delete(providerConfigs);
  await db.delete(users);
}

async function seedUser(role: Actor["role"] = "user"): Promise<Actor> {
  const id = newId();
  await db.insert(users).values({
    id,
    name: `user-${id}`,
    email: `${id}@example.com`,
    username: id,
    role,
  });
  return { userId: id, role };
}

async function seedModel(actor: Actor, modelId = "gpt-4o") {
  const config = await createProviderConfig(
    {
      name: `byok-${newId()}`,
      apiFormat: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      visibility: "private",
    },
    actor,
  );
  await addProviderModel(config.id, { modelId }, actor);
  return { providerConfigId: config.id, modelId };
}

describe("model-preferences.service", () => {
  beforeEach(resetState);
  afterAll(resetState);

  it("returns empty preferences for a fresh user", async () => {
    const actor = await seedUser();
    await expect(getModelPreferences(actor.userId)).resolves.toEqual({});
  });

  it("404s for a missing user", async () => {
    await expect(getModelPreferences(newId())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("stores and reads back a full preference set", async () => {
    const actor = await seedUser();
    const pair = await seedModel(actor);

    const result = await updateModelPreferences(
      { chat: pair, title: pair },
      actor,
    );

    expect(result).toEqual({ chat: pair, title: pair });
    await expect(getModelPreferences(actor.userId)).resolves.toEqual({
      chat: pair,
      title: pair,
    });
  });

  it("replaces the whole set, clearing slots omitted or nulled", async () => {
    const actor = await seedUser();
    const pair = await seedModel(actor);
    await updateModelPreferences({ chat: pair, title: pair }, actor);

    await updateModelPreferences({ chat: null, translation: pair }, actor);

    await expect(getModelPreferences(actor.userId)).resolves.toEqual({
      chat: null,
      translation: pair,
    });
  });

  it("400s when a slot names an unavailable model", async () => {
    const actor = await seedUser();
    const pair = await seedModel(actor);

    await expect(
      updateModelPreferences(
        { chat: pair, title: { providerConfigId: pair.providerConfigId, modelId: "nope" } },
        actor,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "model.notAvailable",
    });
    // The failed write is all-or-nothing: nothing was stored.
    await expect(getModelPreferences(actor.userId)).resolves.toEqual({});
  });

  it("400s when a slot names another user's private config", async () => {
    const owner = await seedUser();
    const otherPair = await seedModel(owner);
    const actor = await seedUser();

    await expect(
      updateModelPreferences({ chat: otherPair }, actor),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("degrades dirty jsonb to empty preferences", async () => {
    const actor = await seedUser();
    await db
      .update(users)
      .set({ modelPreferences: { chat: { providerConfigId: 42 } } })
      .where(eq(users.id, actor.userId));

    await expect(getModelPreferences(actor.userId)).resolves.toEqual({});
  });

  it("resolves a set preference and nulls an unset one", async () => {
    const actor = await seedUser();
    const pair = await seedModel(actor);
    await updateModelPreferences({ title: pair }, actor);

    await expect(resolveModelPreference(actor, "title")).resolves.toEqual(
      pair,
    );
    await expect(resolveModelPreference(actor, "chat")).resolves.toBeNull();
  });

  it("silently resolves to null once the preferred model is gone", async () => {
    const actor = await seedUser();
    const pair = await seedModel(actor);
    await updateModelPreferences({ compression: pair }, actor);

    await db
      .delete(providerModels)
      .where(eq(providerModels.providerConfigId, pair.providerConfigId));

    await expect(
      resolveModelPreference(actor, "compression"),
    ).resolves.toBeNull();
    // The stored preference itself is left untouched.
    await expect(getModelPreferences(actor.userId)).resolves.toEqual({
      compression: pair,
    });
  });
});
