import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
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
  chatMessages,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import { createAssistant } from "@/server/services/assistant.service";
import { searchForActor } from "@/server/services/search.service";
import { createTopicForChat } from "@/server/services/topic.service";

const DEFAULT_TITLE = "New topic";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
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
): Promise<Response> {
  return authPost(
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
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await authPost(
    jsonRequest("/api/auth/sign-in/email", { body: { email, password } }),
  );
  expect(response.status).toBe(200);
  return cookiesFrom(response);
}

async function seedActors() {
  const setup = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(setup.status).toBe(201);
  const superCookie = cookiesFrom(setup);

  for (const credentials of [userCredentials, otherAdminCredentials]) {
    const created = await adminCreateUser(superCookie, credentials);
    expect(created.status).toBe(200);
  }

  const userCookie = await signIn(userCredentials.email, userCredentials.password);
  const otherCookie = await signIn(
    otherAdminCredentials.email,
    otherAdminCredentials.password,
  );

  return {
    userActor: await requireActor(
      jsonRequest("/api/search", { cookie: userCookie }).headers,
    ),
    otherActor: await requireActor(
      jsonRequest("/api/search", { cookie: otherCookie }).headers,
    ),
  };
}

async function insertMessage(input: {
  topicId: string;
  role: "user" | "assistant";
  parts: unknown;
  isSelected?: boolean;
  groupId?: string;
  createdAt: Date;
}): Promise<string> {
  const id = newId();
  await db.insert(chatMessages).values({
    id,
    topicId: input.topicId,
    role: input.role,
    parts: input.parts,
    groupId: input.groupId ?? id,
    isSelected: input.isSelected ?? true,
    createdAt: input.createdAt,
  });
  return id;
}

function textParts(text: string): unknown {
  return [{ type: "text", text }];
}

describe("search.service", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
  });

  it("hits topic titles and message text for the actor's own data", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const titleHit = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    // Direct title writes keep updatedAt ordering out of the test's way.
    await db
      .update(topics)
      .set({ title: "Weekend planning" })
      .where(eq(topics.id, titleHit.id));
    const other = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    const messageId = await insertMessage({
      topicId: other.id,
      role: "user",
      parts: textParts("Tell me about weekend hikes"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await searchForActor(userActor, "weekend");

    expect(result.topics.map((hit) => hit.id)).toEqual([titleHit.id]);
    expect(result.topics[0]?.assistantId).toBe(assistant.id);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      messageId,
      groupId: messageId,
      topicId: other.id,
      assistantId: assistant.id,
      topicTitle: DEFAULT_TITLE,
      role: "user",
      snippet: "Tell me about weekend hikes",
    });
  });

  it("never returns another user's topics or messages", async () => {
    const { userActor, otherActor } = await seedActors();
    const theirs = await createAssistant(
      { name: "Theirs", icon: "🔒" },
      otherActor,
    );
    const topic = await createTopicForChat(
      { assistantId: theirs.id },
      otherActor,
      DEFAULT_TITLE,
    );
    await db
      .update(topics)
      .set({ title: "Secret planning" })
      .where(eq(topics.id, topic.id));
    await insertMessage({
      topicId: topic.id,
      role: "assistant",
      parts: textParts("The secret plan is ready"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await searchForActor(userActor, "secret");
    expect(result.topics).toEqual([]);
    expect(result.messages).toEqual([]);

    // …and the owner does see them.
    const own = await searchForActor(otherActor, "secret");
    expect(own.topics).toHaveLength(1);
    expect(own.messages).toHaveLength(1);
  });

  it("matches % and _ literally, not as wildcards", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const topic = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    await insertMessage({
      topicId: topic.id,
      role: "user",
      parts: textParts("Progress is at 100% done"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await insertMessage({
      topicId: topic.id,
      role: "user",
      parts: textParts("Progress is at 100x done"),
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });

    // A literal "%" must only hit the row containing an actual percent sign;
    // unescaped it would be a wildcard and match both rows.
    const percent = await searchForActor(userActor, "100%");
    expect(percent.messages).toHaveLength(1);
    expect(percent.messages[0]?.snippet).toContain("100%");

    const underscore = await searchForActor(userActor, "100_");
    expect(underscore.messages).toHaveLength(0);
  });

  it("builds an asymmetric snippet window (R7c): ~16 chars head, ~120 total", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const topic = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    const head = "a".repeat(70);
    const tail = "b".repeat(130);
    await insertMessage({
      topicId: topic.id,
      role: "assistant",
      parts: textParts(`${head}needle${tail}`),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await searchForActor(userActor, "needle");
    const snippet = result.messages[0]?.snippet ?? "";
    // 16 chars before the match, the match, then the rest of the 120-char
    // budget after it — plus both ellipses. The match must land inside the
    // first two rendered lines of the sidebar's line-clamp-2 snippet.
    expect(snippet).toBe(`…${"a".repeat(16)}needle${"b".repeat(98)}…`);
    expect(snippet.indexOf("needle")).toBeLessThanOrEqual(30);
  });

  it("skips unselected versions and non-text parts", async () => {
    const { userActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const topic = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    const groupId = newId();
    await insertMessage({
      topicId: topic.id,
      role: "assistant",
      parts: textParts("old draft mentions zebra"),
      isSelected: false,
      groupId,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const selectedId = await insertMessage({
      topicId: topic.id,
      role: "assistant",
      parts: textParts("the final answer"),
      isSelected: true,
      groupId,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    // The keyword lives in a reasoning part only — text-part extraction must
    // not see it.
    await insertMessage({
      topicId: topic.id,
      role: "assistant",
      parts: [
        { type: "reasoning", text: "thinking about zebra" },
        { type: "text", text: "unrelated reply" },
      ],
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });

    const result = await searchForActor(userActor, "zebra");
    expect(result.messages).toEqual([]);

    // The selected version of the same group is still searchable.
    const selected = await searchForActor(userActor, "final answer");
    expect(selected.messages.map((hit) => hit.messageId)).toEqual([
      selectedId,
    ]);
  });
});
