import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import { getDb } from "@/server/db/client";
import {
  APP_SETTINGS_ROW_ID,
  accounts,
  appSettings,
  assistants,
  chatGenerations,
  chatMessages,
  demoUsageCounters,
  files,
  providerConfigs,
  providerModels,
  searchProviderSettings,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";

const db = getDb();

const MANAGED = [
  "DEMO_MODE",
  "CLIENT_IP_HEADER",
  "DEMO_DAILY_MODEL_CALLS",
  "DEMO_DAILY_SEARCH_CALLS",
  "DEMO_DAILY_UPLOADS",
  "DEMO_GUEST_STORAGE_MB",
  "DEMO_GUESTS_PER_IP_DAILY",
  "DEMO_GLOBAL_DAILY_MODEL_CALLS",
  "DEMO_MAX_OUTPUT_TOKENS",
] as const;

let saved: Record<string, string | undefined> = {};

function setDemoEnv(overrides: Partial<Record<(typeof MANAGED)[number], string>> = {}) {
  process.env.DEMO_MODE = "1";
  process.env.CLIENT_IP_HEADER = "x-real-ip";
  for (const [key, val] of Object.entries(overrides)) {
    process.env[key] = val;
  }
}

async function resetDemoDb(): Promise<void> {
  await db.delete(files);
  await db.delete(chatGenerations);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(searchProviderSettings);
  await db.delete(providerModels);
  await db.delete(providerConfigs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(demoUsageCounters);
  await db.delete(users);
  await db
    .update(appSettings)
    .set({ allowRegistration: false, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
}

function demoRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    ip?: string | null;
  } = {},
): Request {
  const headers = new Headers({ origin: "http://localhost:3000" });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (options.ip !== undefined && options.ip !== null) {
    headers.set("x-real-ip", options.ip);
  }
  return new Request(`http://localhost:3000${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

describe("demo mode end-to-end integration", () => {
  beforeEach(async () => {
    saved = {};
    for (const key of MANAGED) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    await resetDemoDb();
  });

  afterEach(() => {
    for (const key of MANAGED) {
      const val = saved[key];
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    vi.resetModules();
  });

  afterAll(async () => {
    await resetDemoDb();
  });

  it("supports anonymous sign-in with generated username, IP cap, missing-IP rejection, and guest blocks on auth + app endpoints", async () => {
    setDemoEnv({ DEMO_GUESTS_PER_IP_DAILY: "2" });
    vi.resetModules();

    const { toNextJsHandler } = await import("better-auth/next-js");
    const { createAuthInstance } = await import("@/server/auth");
    const demoAuth = createAuthInstance();
    const handler = toNextJsHandler(demoAuth);

    // Missing CLIENT_IP_HEADER value -> rejected (403 IP_UNAVAILABLE)
    const missingIpRes = await handler.POST(
      demoRequest("/api/auth/sign-in/anonymous", { body: {}, ip: null }),
    );
    expect(missingIpRes.status).toBe(403);
    expect(await missingIpRes.json()).toMatchObject({ code: "IP_UNAVAILABLE" });

    // Multi-value spoofed header -> rejected (403 IP_UNAVAILABLE)
    const multiIpReq = new Request("http://localhost:3000/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-real-ip": "1.2.3.4, 5.6.7.8",
      },
      body: "{}",
    });
    const multiIpRes = await handler.POST(multiIpReq);
    expect(multiIpRes.status).toBe(403);

    // 1st and 2nd guest from IP 198.51.100.10 succeed.
    const guest1Res = await handler.POST(
      demoRequest("/api/auth/sign-in/anonymous", {
        body: {},
        ip: "198.51.100.10",
      }),
    );
    expect(guest1Res.status).toBe(200);
    const guest1Cookie = cookiesFrom(guest1Res);
    const guest1Body = (await guest1Res.json()) as {
      user: { id: string; isAnonymous: boolean; username: string };
    };
    expect(guest1Body.user.isAnonymous).toBe(true);
    expect(guest1Body.user.username).toMatch(/^guest-/);

    const guest2Res = await handler.POST(
      demoRequest("/api/auth/sign-in/anonymous", {
        body: {},
        ip: "198.51.100.10",
      }),
    );
    expect(guest2Res.status).toBe(200);

    // 3rd guest from same IP is rejected (429 GUEST_IP_LIMIT).
    const guest3Res = await handler.POST(
      demoRequest("/api/auth/sign-in/anonymous", {
        body: {},
        ip: "198.51.100.10",
      }),
    );
    expect(guest3Res.status).toBe(429);
    expect(await guest3Res.json()).toMatchObject({ code: "GUEST_IP_LIMIT" });

    // Guest is blocked on change-password, update-user, 2FA, and revoke-sessions.
    for (const [path, body] of [
      ["/api/auth/change-password", { currentPassword: "a", newPassword: "b" }],
      ["/api/auth/update-user", { name: "hacker" }],
      ["/api/auth/two-factor/enable", { password: "a" }],
      ["/api/auth/revoke-other-sessions", {}],
    ] as const) {
      const blocked = await handler.POST(
        demoRequest(path, { body, cookie: guest1Cookie, ip: "198.51.100.10" }),
      );
      expect(blocked.status, path).toBe(403);
    }

    // R2 routes block guests with 403.
    const { GET: getProviders } = await import("@/app/api/providers/route");
    const { GET: getSearchProviders } = await import(
      "@/app/api/search-providers/route"
    );
    const { POST: postQrCode } = await import(
      "@/app/api/account/2fa/qrcode/route"
    );
    for (const [label, fn, path] of [
      ["providers", getProviders, "/api/providers"],
      ["search-providers", getSearchProviders, "/api/search-providers"],
      ["2fa qrcode", postQrCode, "/api/account/2fa/qrcode"],
    ] as const) {
      const r = await fn(
        demoRequest(path, {
          method: label === "2fa qrcode" ? "POST" : "GET",
          cookie: guest1Cookie,
          ip: "198.51.100.10",
          ...(label === "2fa qrcode" ? { body: { uri: "otpauth://totp/x" } } : {}),
        }),
      );
      expect(r.status, label).toBe(403);
    }

    // Registration is forced off in demo mode.
    const { getInstanceState } = await import(
      "@/server/services/instance-settings.service"
    );
    const { registerUser } = await import(
      "@/server/services/registration.service"
    );
    await db
      .update(appSettings)
      .set({ allowRegistration: true })
      .where(eq(appSettings.id, APP_SETTINGS_ROW_ID));
    expect(await getInstanceState()).toMatchObject({
      demo: true,
      allowRegistration: false,
    });
    await expect(
      registerUser({
        username: "newmember",
        email: "newmember@example.com",
        password: "password123",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("enforces guest limits in acceptTurn, output budget, uploads, storage quota, and operator inheritance", async () => {
    setDemoEnv({
      DEMO_DAILY_MODEL_CALLS: "2",
      DEMO_DAILY_UPLOADS: "2",
      DEMO_GUEST_STORAGE_MB: "1",
      DEMO_MAX_OUTPUT_TOKENS: "16384",
    });
    vi.resetModules();

    const { createAssistant } = await import("@/server/services/assistant.service");
    const {
      admitTurn,
      finalizeGeneration,
    } = await import("@/server/services/generation.service");
    const { resolvedMaxOutputTokens } = await import("@/server/ai/output-budget");
    const { effectiveQuotaBytes } = await import("@/server/files/quota");
    const { uploadFile } = await import("@/server/files/file.service");
    const {
      addProviderModel,
      createProviderConfig,
    } = await import("@/server/services/provider.service");
    const {
      resolveModelPreference,
      updateModelPreferences,
    } = await import("@/server/services/model-preferences.service");
    const {
      resolveSearchProviderCredentials,
      upsertSearchProviderSetting,
    } = await import("@/server/services/search-provider.service");
    const { buildSearchTools } = await import("@/server/ai/search/tool");
    const { getGuestUsage } = await import("@/server/services/demo-usage.service");

    // Seed operator (super_admin) + shared model + operator preferences + search provider.
    const operatorId = newId();
    const guestId = newId();
    await db.insert(users).values([
      {
        id: operatorId,
        name: "Operator",
        email: "op@example.com",
        username: "operator",
        role: "super_admin",
        isAnonymous: false,
      },
      {
        id: guestId,
        name: "Guest",
        email: "guest@anon.invalid",
        username: "guest-123",
        role: "user",
        isAnonymous: true,
      },
    ]);
    const operatorActor = { userId: operatorId, role: "super_admin" as const, isGuest: false };
    const guestActor = { userId: guestId, role: "user" as const, isGuest: true };

    const sharedCfg = await createProviderConfig(
      {
        name: "Shared OpenAI",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-op",
        visibility: "shared",
      },
      operatorActor,
    );
    await addProviderModel(sharedCfg.id, { modelId: "gpt-4o" }, operatorActor);

    await updateModelPreferences(
      {
        title: { providerConfigId: sharedCfg.id, modelId: "gpt-4o" },
        compression: { providerConfigId: sharedCfg.id, modelId: "gpt-4o" },
        translation: { providerConfigId: sharedCfg.id, modelId: "gpt-4o" },
      },
      operatorActor,
    );
    await upsertSearchProviderSetting(
      "tavily",
      { apiKey: "tvly-operator-secret" },
      operatorActor,
    );

    // Guest inherits operator's non-chat prefs & search creds, and can only write `chat` slot.
    await expect(
      updateModelPreferences(
        { title: { providerConfigId: sharedCfg.id, modelId: "gpt-4o" } },
        guestActor,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await updateModelPreferences(
      { chat: { providerConfigId: sharedCfg.id, modelId: "gpt-4o" } },
      guestActor,
    );
    await expect(resolveModelPreference(guestActor, "title")).resolves.toEqual({
      providerConfigId: sharedCfg.id,
      modelId: "gpt-4o",
    });
    // An operator preference on an operator-private model is not usable by the
    // guest, so it falls back instead of failing at handle resolution.
    const privateCfg = await createProviderConfig(
      {
        name: "Operator private",
        apiFormat: "openai-compatible",
        baseUrl: "https://private.example.com/v1",
        apiKey: "sk-private",
        visibility: "private",
      },
      operatorActor,
    );
    await addProviderModel(privateCfg.id, { modelId: "gpt-4o" }, operatorActor);
    await updateModelPreferences(
      {
        title: { providerConfigId: sharedCfg.id, modelId: "gpt-4o" },
        translation: { providerConfigId: privateCfg.id, modelId: "gpt-4o" },
      },
      operatorActor,
    );
    await expect(
      resolveModelPreference(guestActor, "translation"),
    ).resolves.toBeNull();
    await expect(resolveSearchProviderCredentials(guestActor)).resolves.toEqual([
      { provider: "tavily", apiKey: "tvly-operator-secret", baseUrl: null },
    ]);

    // Output token cap & storage quota for guest vs non-guest.
    expect(
      resolvedMaxOutputTokens({ outputTokens: 65536, contextTokens: 128000 }, true),
    ).toBe(16384);
    expect(
      resolvedMaxOutputTokens({ outputTokens: 65536, contextTokens: 128000 }, false),
    ).toBe(65536);
    await expect(effectiveQuotaBytes(guestActor)).resolves.toBe(1024 * 1024);

    // acceptTurn: busy guest rejected, duplicate receipt not counted, over-limit rejected and nothing persisted.
    const assistant = await createAssistant({ name: "Demo", icon: "✨" }, guestActor);
    const topic1 = newId();
    void topic1;

    const reqId1 = "019a0000-0000-7000-8000-000000000001";
    const turn1 = await admitTurn(
      { requestId: reqId1, requestHash: "h1" },
      async () => ({
        kind: "send",
        assistantId: assistant.id,
        topicId: null,
        providerConfigId: sharedCfg.id,
        modelId: "gpt-4o",
        historyMessageIds: [],
        userMessage: {
          message: { id: "u-g1", role: "user", parts: [{ type: "text", text: "1" }] },
        },
        defaultTopicTitle: "New topic",
        titleCandidate: true,
        actorRole: "user",
        actorIsGuest: true,
        requestHash: "h1",
      }),
      guestActor,
      { clock: async () => new Date(0x019a00000000) },
    );
    expect(turn1.duplicate).toBe(false);

    // Duplicate receipt does NOT count and does NOT trigger busy.
    const dup1 = await admitTurn(
      { requestId: reqId1, requestHash: "h1" },
      async () => {
        throw new Error("should not prepare duplicate");
      },
      guestActor,
    );
    expect(dup1.duplicate).toBe(true);

    // Second turn on another topic while turn1 is active -> 409 demo.busy, and quota NOT consumed.
    await expect(
      admitTurn(
        { requestHash: "h2" },
        async () => ({
          kind: "send",
          assistantId: assistant.id,
          topicId: null,
          providerConfigId: sharedCfg.id,
          modelId: "gpt-4o",
          historyMessageIds: [],
          userMessage: {
            message: { id: "u-g2", role: "user", parts: [{ type: "text", text: "2" }] },
          },
          defaultTopicTitle: "New topic",
          titleCandidate: true,
          actorRole: "user",
          actorIsGuest: true,
          requestHash: "h2",
        }),
        guestActor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409, messageKey: "demo.busy" });
    expect((await getGuestUsage(guestId)).model.used).toBe(1);

    // Finish turn1, consume 2nd turn, then 3rd turn fails with demo.modelLimit and persists nothing.
    await finalizeGeneration({
      id: turn1.generation.id,
      topicId: turn1.generation.topicId,
      assistantMessageId: turn1.generation.assistantMessageId,
      status: "completed",
    });

    const turn2 = await admitTurn(
      { requestHash: "h2" },
      async () => ({
        kind: "send",
        assistantId: assistant.id,
        topicId: null,
        providerConfigId: sharedCfg.id,
        modelId: "gpt-4o",
        historyMessageIds: [],
        userMessage: {
          message: { id: "u-g2", role: "user", parts: [{ type: "text", text: "2" }] },
        },
        defaultTopicTitle: "New topic",
        titleCandidate: true,
        actorRole: "user",
        actorIsGuest: true,
        requestHash: "h2",
      }),
      guestActor,
    );
    await finalizeGeneration({
      id: turn2.generation.id,
      topicId: turn2.generation.topicId,
      assistantMessageId: turn2.generation.assistantMessageId,
      status: "completed",
    });

    const beforeTopics = await db.select().from(topics);
    await expect(
      admitTurn(
        { requestHash: "h3" },
        async () => ({
          kind: "send",
          assistantId: assistant.id,
          topicId: null,
          providerConfigId: sharedCfg.id,
          modelId: "gpt-4o",
          historyMessageIds: [],
          userMessage: {
            message: { id: "u-g3", role: "user", parts: [{ type: "text", text: "3" }] },
          },
          defaultTopicTitle: "New topic",
          titleCandidate: true,
          actorRole: "user",
          actorIsGuest: true,
          requestHash: "h3",
        }),
        guestActor,
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      messageKey: "demo.modelLimit",
    });
    expect(await db.select().from(topics)).toHaveLength(beforeTopics.length);

    // Search tool limit_reached output after 10 calls.
    const { consumeDemoQuota } = await import(
      "@/server/services/demo-usage.service"
    );
    for (let i = 0; i < 10; i += 1) {
      await consumeDemoQuota({ subject: guestId, kind: "search", limit: 10 });
    }
    const tools = buildSearchTools(
      [{ provider: "tavily", apiKey: "tvly-test", baseUrl: null }],
      { guestUserId: guestId },
    );
    const searchOut = await tools.searchWeb?.execute?.(
      { query: "latest" },
      { toolCallId: "tc-1", messages: [], context: {} },
    );
    expect(searchOut).toEqual({ error: "limit_reached", attemptedProviders: [] });

    // Upload quota (count = 2) and cleanup for test storage invariant.
    const f1 = await uploadFile(
      { filename: "a.txt", mediaType: "text/plain", data: Buffer.from("hello") },
      guestActor,
    );
    const f2 = await uploadFile(
      { filename: "b.txt", mediaType: "text/plain", data: Buffer.from("world") },
      guestActor,
    );
    await expect(
      uploadFile(
        { filename: "c.txt", mediaType: "text/plain", data: Buffer.from("over") },
        guestActor,
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      messageKey: "demo.uploadLimit",
    });

    const { deleteFile } = await import("@/server/files/file.service");
    await deleteFile(f1.id, guestActor);
    await deleteFile(f2.id, guestActor);
  });
});
