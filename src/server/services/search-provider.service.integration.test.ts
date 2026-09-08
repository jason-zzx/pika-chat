import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getSearchProviders } from "@/app/api/search-providers/route";
import {
  PUT as putSearchProvider,
  DELETE as deleteSearchProvider,
} from "@/app/api/search-providers/[provider]/route";
import { PATCH as patchSearchProviderOrder } from "@/app/api/search-providers/order/route";
import {
  adminCredentials,
  authPost,
  cookiesFrom,
  jsonRequest,
  readJson,
  userCredentials,
  otherAdminCredentials,
  postSetup,
} from "@/server/auth/auth-test-helpers";
import { requireActor } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  searchProviderSettings,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";
import {
  deleteSearchProviderSetting,
  listSearchProviderSettings,
  reorderSearchProviders,
  resolveSearchProviderCredentials,
  upsertSearchProviderSetting,
} from "@/server/services/search-provider.service";

const db = getDb();

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected an object");
}

function errorCode(payload: unknown): string {
  const nested = asObject(payload).error;
  if (typeof nested === "object" && nested !== null && "code" in nested) {
    const code = nested.code;
    if (typeof code === "string") {
      return code;
    }
  }
  throw new Error("expected error.code");
}

async function resetState(): Promise<void> {
  await db.delete(searchProviderSettings);
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
  input: { username: string; email: string; password: string },
): Promise<void> {
  const response = await authPost(
    jsonRequest("/api/auth/admin/create-user", {
      cookie,
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        role: "user",
        data: { username: input.username },
      },
    }),
  );
  expect(response.status).toBe(200);
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await authPost(
    jsonRequest("/api/auth/sign-in/email", { body: { email, password } }),
  );
  expect(response.status).toBe(200);
  return cookiesFrom(response);
}

async function actorFromCookie(cookie: string): Promise<Actor> {
  return requireActor(jsonRequest("/api/search-providers", { cookie }).headers);
}

async function seedActors(): Promise<{
  userActor: Actor;
  otherActor: Actor;
  userCookie: string;
  otherCookie: string;
}> {
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);

  await adminCreateUser(superCookie, userCredentials);
  await adminCreateUser(superCookie, otherAdminCredentials);

  const userCookie = await signIn(
    userCredentials.email,
    userCredentials.password,
  );
  const otherCookie = await signIn(
    otherAdminCredentials.email,
    otherAdminCredentials.password,
  );
  return {
    userActor: await actorFromCookie(userCookie),
    otherActor: await actorFromCookie(otherCookie),
    userCookie,
    otherCookie,
  };
}

describe("search-provider.service", () => {
  beforeEach(resetState);
  afterAll(resetState);

  it("creates a setting, returning only the last four of the key", async () => {
    const { userActor } = await seedActors();

    const created = await upsertSearchProviderSetting(
      "tavily",
      { apiKey: "tvly-secret-key-1234" },
      userActor,
    );

    expect(created).toMatchObject({
      provider: "tavily",
      baseUrl: null,
      apiKeyLastFour: "1234",
      position: 0,
    });
    expect(created).not.toHaveProperty("encryptedApiKey");
    expect(created).not.toHaveProperty("apiKey");
  });

  it("requires an API key when creating", async () => {
    const { userActor } = await seedActors();

    await expect(
      upsertSearchProviderSetting("exa", {}, userActor),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("keeps the stored key when an update omits apiKey", async () => {
    const { userActor } = await seedActors();
    await upsertSearchProviderSetting(
      "tavily",
      { apiKey: "tvly-original-key-aaaa" },
      userActor,
    );

    const updated = await upsertSearchProviderSetting(
      "tavily",
      { baseUrl: "https://tavily-proxy.example.com" },
      userActor,
    );

    expect(updated.apiKeyLastFour).toBe("aaaa");
    expect(updated.baseUrl).toBe("https://tavily-proxy.example.com");
    const credentials = await resolveSearchProviderCredentials(userActor);
    expect(credentials[0]?.apiKey).toBe("tvly-original-key-aaaa");
  });

  it("rotates the key and clears the base URL on update", async () => {
    const { userActor } = await seedActors();
    await upsertSearchProviderSetting(
      "brave",
      { apiKey: "brave-old-1111", baseUrl: "https://brave-proxy.example.com" },
      userActor,
    );

    const updated = await upsertSearchProviderSetting(
      "brave",
      { apiKey: "brave-new-2222", baseUrl: null },
      userActor,
    );

    expect(updated.apiKeyLastFour).toBe("2222");
    expect(updated.baseUrl).toBeNull();
    const credentials = await resolveSearchProviderCredentials(userActor);
    expect(credentials[0]?.apiKey).toBe("brave-new-2222");
  });

  it("lists settings in position order and appends new providers", async () => {
    const { userActor } = await seedActors();
    await upsertSearchProviderSetting("brave", { apiKey: "k-brave" }, userActor);
    await upsertSearchProviderSetting("tavily", { apiKey: "k-tavily" }, userActor);
    await upsertSearchProviderSetting("exa", { apiKey: "k-exa" }, userActor);

    const listed = await listSearchProviderSettings(userActor);

    expect(listed.map((s) => [s.provider, s.position])).toEqual([
      ["brave", 0],
      ["tavily", 1],
      ["exa", 2],
    ]);
  });

  it("compacts positions after delete", async () => {
    const { userActor } = await seedActors();
    await upsertSearchProviderSetting("brave", { apiKey: "k-brave" }, userActor);
    await upsertSearchProviderSetting("tavily", { apiKey: "k-tavily" }, userActor);
    await upsertSearchProviderSetting("exa", { apiKey: "k-exa" }, userActor);

    await deleteSearchProviderSetting("tavily", userActor);

    const listed = await listSearchProviderSettings(userActor);
    expect(listed.map((s) => [s.provider, s.position])).toEqual([
      ["brave", 0],
      ["exa", 1],
    ]);
  });

  it("returns NOT_FOUND when deleting an unconfigured provider", async () => {
    const { userActor } = await seedActors();

    await expect(
      deleteSearchProviderSetting("tavily", userActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("reorders the fallback chain", async () => {
    const { userActor } = await seedActors();
    await upsertSearchProviderSetting("brave", { apiKey: "k-brave" }, userActor);
    await upsertSearchProviderSetting("tavily", { apiKey: "k-tavily" }, userActor);

    const reordered = await reorderSearchProviders(
      { providers: ["tavily", "brave"] },
      userActor,
    );

    expect(reordered.map((s) => [s.provider, s.position])).toEqual([
      ["tavily", 0],
      ["brave", 1],
    ]);
    // The execution view follows the same order.
    const credentials = await resolveSearchProviderCredentials(userActor);
    expect(credentials.map((c) => c.provider)).toEqual(["tavily", "brave"]);
  });

  it("rejects a reorder that is not a permutation of configured providers", async () => {
    const { userActor } = await seedActors();
    await upsertSearchProviderSetting("brave", { apiKey: "k-brave" }, userActor);

    await expect(
      reorderSearchProviders({ providers: ["brave", "tavily"] }, userActor),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      reorderSearchProviders({ providers: ["brave", "brave"] }, userActor),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      reorderSearchProviders({ providers: [] }, userActor),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("isolates settings per user", async () => {
    const { userActor, otherActor } = await seedActors();
    await upsertSearchProviderSetting(
      "tavily",
      { apiKey: "tvly-user-key-9999" },
      userActor,
    );

    // The other user sees nothing and cannot delete the row.
    expect(await listSearchProviderSettings(otherActor)).toEqual([]);
    await expect(
      deleteSearchProviderSetting("tavily", otherActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The other user's own upsert creates their own row, leaving the
    // original untouched.
    await upsertSearchProviderSetting(
      "tavily",
      { apiKey: "tvly-other-key-5555" },
      otherActor,
    );
    const mine = await resolveSearchProviderCredentials(userActor);
    expect(mine[0]?.apiKey).toBe("tvly-user-key-9999");
  });
});

describe("search-provider routes", () => {
  beforeEach(resetState);

  it("supports the full lifecycle over HTTP without ever exposing the key", async () => {
    const { userCookie } = await seedActors();

    const created = await putSearchProvider(
      jsonRequest("/api/search-providers/tavily", {
        method: "PUT",
        cookie: userCookie,
        body: { apiKey: "tvly-route-key-4321" },
      }),
      { params: Promise.resolve({ provider: "tavily" }) },
    );
    expect(created.status).toBe(200);
    const createdBody = asObject(await readJson(created));
    expect(createdBody.apiKeyLastFour).toBe("4321");
    expect(JSON.stringify(createdBody)).not.toContain("tvly-route-key");

    await putSearchProvider(
      jsonRequest("/api/search-providers/exa", {
        method: "PUT",
        cookie: userCookie,
        body: { apiKey: "exa-route-key", baseUrl: "https://exa-proxy.example.com" },
      }),
      { params: Promise.resolve({ provider: "exa" }) },
    );

    const listed = await getSearchProviders(
      jsonRequest("/api/search-providers", { cookie: userCookie }),
    );
    expect(listed.status).toBe(200);
    const listBody = asObject(await readJson(listed));
    const providers = listBody.providers;
    expect(Array.isArray(providers)).toBe(true);
    expect(JSON.stringify(listBody)).not.toContain("tvly-route-key");
    expect(JSON.stringify(listBody)).not.toContain("exa-route-key");

    const reordered = await patchSearchProviderOrder(
      jsonRequest("/api/search-providers/order", {
        method: "PATCH",
        cookie: userCookie,
        body: { providers: ["exa", "tavily"] },
      }),
    );
    expect(reordered.status).toBe(200);
    const reorderedBody = asObject(await readJson(reordered));
    expect(
      (reorderedBody.providers as { provider: string }[]).map(
        (p) => p.provider,
      ),
    ).toEqual(["exa", "tavily"]);

    const deleted = await deleteSearchProvider(
      jsonRequest("/api/search-providers/exa", {
        method: "DELETE",
        cookie: userCookie,
      }),
      { params: Promise.resolve({ provider: "exa" }) },
    );
    expect(deleted.status).toBe(204);
  });

  it("rejects unauthenticated requests", async () => {
    const response = await getSearchProviders(
      jsonRequest("/api/search-providers"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an unknown provider name with VALIDATION_FAILED", async () => {
    const { userCookie } = await seedActors();

    const response = await putSearchProvider(
      jsonRequest("/api/search-providers/unknown", {
        method: "PUT",
        cookie: userCookie,
        body: { apiKey: "key" },
      }),
      { params: Promise.resolve({ provider: "unknown" }) },
    );

    expect(response.status).toBe(400);
    expect(errorCode(await readJson(response))).toBe("VALIDATION_FAILED");
  });

  it("rejects a create without an API key at the service boundary", async () => {
    const { userCookie } = await seedActors();

    const response = await putSearchProvider(
      jsonRequest("/api/search-providers/tavily", {
        method: "PUT",
        cookie: userCookie,
        body: {},
      }),
      { params: Promise.resolve({ provider: "tavily" }) },
    );

    expect(response.status).toBe(400);
    expect(errorCode(await readJson(response))).toBe("VALIDATION_FAILED");
  });

  it("does not let another user read settings over HTTP", async () => {
    const { userActor, otherCookie } = await seedActors();
    await upsertSearchProviderSetting(
      "tavily",
      { apiKey: "tvly-hidden-key" },
      userActor,
    );

    const response = await getSearchProviders(
      jsonRequest("/api/search-providers", { cookie: otherCookie }),
    );

    expect(response.status).toBe(200);
    expect(asObject(await readJson(response)).providers).toEqual([]);
  });
});
