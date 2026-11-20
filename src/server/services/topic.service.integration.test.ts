import "server-only";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newTopicId } from "@/lib/id";
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
  providerConfigs,
  providerModels,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import { createAssistant } from "@/server/services/assistant.service";
import {
  appendUserMessage,
  listTopicMessages,
} from "@/server/services/message.service";
import {
  createTopicForChat,
  deleteTopic,
  findTopicContextForActor,
  findTopicForActor,
  listFavoriteTopics,
  listTopicPage,
  renameTopic,
  setTopicFavorite,
  touchTopicUpdatedAt,
} from "@/server/services/topic.service";

/** The route boundary resolves the real `Chat.newTopic`; the service stores
 * whatever localized default it is handed. */
const DEFAULT_TITLE = "New topic";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(chatMessages);
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
    const created = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    expect(created.title).toBe(DEFAULT_TITLE);

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

  it("toggles the favorite flag without bumping updatedAt", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const created = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    expect(created.isFavorite).toBe(false);

    const favorited = await setTopicFavorite(
      created.id,
      { favorite: true },
      userActor,
    );
    expect(favorited.isFavorite).toBe(true);
    // updatedAt is the last-active-time sort key; favoriting is not activity.
    expect(favorited.updatedAt).toEqual(created.updatedAt);

    const unfavorited = await setTopicFavorite(
      created.id,
      { favorite: false },
      userActor,
    );
    expect(unfavorited.isFavorite).toBe(false);
    expect(unfavorited.updatedAt).toEqual(created.updatedAt);

    await expect(
      setTopicFavorite(created.id, { favorite: true }, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stored = await db
      .select({ isFavorite: topics.isFavorite, updatedAt: topics.updatedAt })
      .from(topics)
      .where(eq(topics.id, created.id));
    expect(stored[0]?.isFavorite).toBe(false);
    expect(stored[0]?.updatedAt).toEqual(created.updatedAt);
  });

  describe("topic pages", () => {
    async function seedTopics(
      assistantId: string,
      count: number,
      options?: { favorite?: boolean },
    ): Promise<string[]> {
      const ids = Array.from({ length: count }, () => newTopicId());
      await db.insert(topics).values(
        ids.map((id, index) => ({
          id,
          assistantId,
          title: `Topic ${index}`,
          isFavorite: options?.favorite ?? false,
          // Newest first by index: ids[0] is the most recently active.
          updatedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000),
        })),
      );
      return ids;
    }

    async function readAll(
      assistantId: string,
      actor: Parameters<typeof listTopicPage>[2],
    ): Promise<string[][]> {
      const pages: string[][] = [];
      let cursor: [string, string] | null = null;
      do {
        const page = await listTopicPage(assistantId, cursor, actor);
        pages.push(page.topics.map((topic) => topic.id));
        cursor = page.nextCursor;
      } while (cursor);
      return pages;
    }

    it("pages non-favorites 20 at a time, newest first, and ends with a null cursor", async () => {
      const { userActor } = await seedActors();
      const assistant = await createAssistant({ name: "Pages", icon: "✨" }, userActor);
      const ids = await seedTopics(assistant.id, 45);

      const first = await listTopicPage(assistant.id, null, userActor);
      expect(first.topics).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();

      const pages = await readAll(assistant.id, userActor);
      expect(pages.map((page) => page.length)).toEqual([20, 20, 5]);
      expect(pages.flat()).toEqual(ids);
    });

    it("keeps pages free of duplicates and skips when a topic is touched in between", async () => {
      const { userActor } = await seedActors();
      const assistant = await createAssistant({ name: "Touch", icon: "✨" }, userActor);
      const ids = await seedTopics(assistant.id, 25);

      const first = await listTopicPage(assistant.id, null, userActor);
      // One topic already shown and one still ahead both become newest.
      await touchTopicUpdatedAt(ids[4] ?? "", userActor);
      await touchTopicUpdatedAt(ids[22] ?? "", userActor);
      const second = await listTopicPage(
        assistant.id,
        first.nextCursor,
        userActor,
      );

      const seen = [...first.topics, ...second.topics].map((topic) => topic.id);
      expect(new Set(seen).size).toBe(seen.length);
      // The topic touched ahead of the cursor moves to the top and so shows
      // up on a refetched page 1; every other topic is seen exactly once.
      const untouched = ids.filter((id) => id !== ids[22]);
      expect([...untouched].sort()).toEqual(
        [...seen].sort(),
      );
      const refetched = await listTopicPage(assistant.id, null, userActor);
      expect(refetched.topics.slice(0, 2).map((topic) => topic.id).sort()).toEqual(
        [ids[4], ids[22]].sort(),
      );
    });

    it("does not skip rows that share a millisecond across a page boundary", async () => {
      const { userActor } = await seedActors();
      const assistant = await createAssistant({ name: "Ties", icon: "✨" }, userActor);
      const ids = await seedTopics(assistant.id, 25);
      // Microsecond-spaced inside one millisecond: a millisecond cursor
      // would drop or repeat rows on the boundary at 20.
      await Promise.all(
        ids.map((id, index) =>
          db
            .update(topics)
            .set({
              updatedAt: sql`timestamptz '2026-01-01 00:00:00.123000+00' - ${index} * interval '1 microsecond'`,
            })
            .where(eq(topics.id, id)),
        ),
      );

      const pages = await readAll(assistant.id, userActor);
      expect(pages.map((page) => page.length)).toEqual([20, 5]);
      expect(pages.flat()).toEqual(ids);
    });

    it("breaks identical updated_at ties by id", async () => {
      const { userActor } = await seedActors();
      const assistant = await createAssistant({ name: "Same", icon: "✨" }, userActor);
      const ids = await seedTopics(assistant.id, 25);
      await db
        .update(topics)
        .set({ updatedAt: new Date("2026-01-01T00:00:00.000Z") })
        .where(eq(topics.assistantId, assistant.id));

      const seen = (await readAll(assistant.id, userActor)).flat();
      expect(seen).toHaveLength(25);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it("excludes favorites from pages and lists every favorite", async () => {
      const { userActor } = await seedActors();
      const assistant = await createAssistant({ name: "Fav", icon: "✨" }, userActor);
      await seedTopics(assistant.id, 3);
      const favorites = await seedTopics(assistant.id, 25, { favorite: true });

      const pages = (await readAll(assistant.id, userActor)).flat();
      expect(pages).toHaveLength(3);
      expect(pages.some((id) => favorites.includes(id))).toBe(false);

      const listed = await listFavoriteTopics(assistant.id, userActor);
      expect(listed.map((topic) => topic.id)).toEqual(favorites);
    });

    it("returns NOT_FOUND for another user's assistant", async () => {
      const { userActor, otherAdminActor } = await seedActors();
      const assistant = await createAssistant({ name: "Mine", icon: "✨" }, userActor);

      await expect(
        listTopicPage(assistant.id, null, otherAdminActor),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        listFavoriteTopics(assistant.id, otherAdminActor),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("returns 404 when creating under an assistant the actor does not own", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const theirs = await createAssistant(
      { name: "Theirs", icon: "🔒" },
      otherAdminActor,
    );
    await expect(
      createTopicForChat({ assistantId: theirs.id }, userActor, DEFAULT_TITLE),
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
    const topic = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );

    await expect(
      renameTopic(topic.id, { title: "Stolen" }, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteTopic(topic.id, otherAdminActor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await findTopicForActor(topic.id, otherAdminActor)).toBeNull();
    expect(await findTopicForActor(topic.id, userActor)).toMatchObject({
      id: topic.id,
      title: DEFAULT_TITLE,
    });
    expect(await findTopicContextForActor(topic.id, otherAdminActor)).toBeNull();
    expect(await findTopicContextForActor(topic.id, userActor)).toMatchObject({
      topic: { id: topic.id, title: DEFAULT_TITLE },
      assistant: { id: assistant.id },
    });
  });

  it("returns NOT_FOUND when another user lists or appends messages", async () => {
    const { userActor, otherAdminActor } = await seedActors();
    const assistant = await createAssistant(
      { name: "Owner", icon: "✨" },
      userActor,
    );
    const topic = await createTopicForChat(
      { assistantId: assistant.id },
      userActor,
      DEFAULT_TITLE,
    );
    await appendUserMessage(
      {
        topicId: topic.id,
        message: {
          id: "msg-owner",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      },
      userActor,
    );

    await expect(
      listTopicMessages({ topicId: topic.id }, otherAdminActor),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      appendUserMessage(
        {
          topicId: topic.id,
          message: {
            id: "msg-stolen",
            role: "user",
            parts: [{ type: "text", text: "nope" }],
          },
        },
        otherAdminActor,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const listed = await listTopicMessages({ topicId: topic.id }, userActor);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("msg-owner");
  });

  it("deletes messages when the topic is deleted", async () => {
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
    await appendUserMessage(
      {
        topicId: topic.id,
        message: {
          id: "msg-gone",
          role: "user",
          parts: [{ type: "text", text: "bye" }],
        },
      },
      userActor,
    );

    await deleteTopic(topic.id, userActor);
    const leftover = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.topicId, topic.id));
    expect(leftover).toEqual([]);
  });
});
