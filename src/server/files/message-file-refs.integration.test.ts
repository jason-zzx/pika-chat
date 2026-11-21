import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import type { Actor } from "@/server/auth/actor";
import { getDb, getSqliteClient } from "@/server/db/client";
import {
  assistants,
  chatMessages,
  files,
  messageFileRefs,
  topics,
  users,
} from "@/server/db/schema";
import {
  deleteFile,
  fileIdsForTopics,
  listFilesForActor,
  sweepOrphanFiles,
  uploadFile,
} from "@/server/files/file.service";
import {
  createAssistant,
  deleteAssistant,
} from "@/server/services/assistant.service";
import { deleteMessage } from "@/server/services/message.service";
import {
  createTopicForChat,
  deleteTopic,
} from "@/server/services/topic.service";

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(files);
  await db.delete(users);
}

async function seedActor(): Promise<{ actor: Actor; primaryAssistantId: string }> {
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    name: "Owner",
    email: `${userId}@example.test`,
    username: `u_${userId.slice(0, 8)}`,
    role: "user",
    emailVerified: true,
    banned: false,
  });
  const actor: Actor = { userId, role: "user" };
  const primary = await createAssistant({ name: "Primary", icon: "✨" }, actor);
  return { actor, primaryAssistantId: primary.id };
}

function refsOf(messageId: string): { fileId: string }[] {
  return db
    .select({ fileId: messageFileRefs.fileId })
    .from(messageFileRefs)
    .where(eq(messageFileRefs.messageId, messageId))
    .all();
}

/** SQL of every statement `run` prepares that reads `message_file_refs`. */
async function refsQueriesDuring(run: () => Promise<unknown>): Promise<string[]> {
  const prepare = vi.spyOn(getSqliteClient(), "prepare");
  try {
    await run();
    return prepare.mock.calls
      .map(([source]) => source)
      .filter((source) => source.includes("message_file_refs"));
  } finally {
    prepare.mockRestore();
  }
}

/** Query plan of a captured statement; plans do not depend on bound values. */
function queryPlan(source: string): string {
  const params = Array.from(source.matchAll(/\?/g), () => null);
  return getSqliteClient()
    .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${source}`)
    .all(...params)
    .map((row) => row.detail)
    .join(" | ");
}

describe("message_file_refs triggers and query plans", () => {
  beforeEach(resetState);
  afterAll(resetState);

  it("maintains message_file_refs on INSERT, UPDATE OF parts, and ignores invalid parts", async () => {
    const { actor, primaryAssistantId } = await seedActor();
    const topic = await createTopicForChat(
      { assistantId: primaryAssistantId },
      actor,
      "Refs test",
    );
    const f1 = await uploadFile(
      { filename: "a.png", mediaType: "image/png", data: Buffer.from("a") },
      actor,
      { skipSizeLimit: true },
    );
    const f2 = await uploadFile(
      { filename: "b.png", mediaType: "image/png", data: Buffer.from("b") },
      actor,
      { skipSizeLimit: true },
    );

    const msgId = newId();
    db.insert(chatMessages)
      .values({
        id: msgId,
        topicId: topic.id,
        role: "user",
        groupId: msgId,
        parts: [
          "non-object-string",
          { type: "file", url: f1.url, mediaType: "image/png", filename: "a.png" },
          { type: "file", url: f1.url, mediaType: "image/png", filename: "a.png" },
          { type: "file", url: "/api/files/", mediaType: "image/png", filename: "empty" },
          { type: "file", url: "/API/files/wrong-case", mediaType: "image/png", filename: "case" },
          { type: "file", url: "https://cdn.example/api/files/remote", mediaType: "image/png", filename: "remote" },
          { type: "file", url: 42, mediaType: "image/png", filename: "number" },
          { type: "text", text: "hello" },
        ],
      })
      .run();

    expect(refsOf(msgId)).toEqual([{ fileId: f1.id }]);

    await expect(deleteFile(f1.id, actor)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    // Update parts to replace f1 with f2: f1 becomes deletable and orphan-sweepable.
    db.update(chatMessages)
      .set({
        parts: [
          { type: "file", url: f2.url, mediaType: "image/png", filename: "b.png" },
        ],
      })
      .where(eq(chatMessages.id, msgId))
      .run();

    expect(refsOf(msgId)).toEqual([{ fileId: f2.id }]);

    await deleteFile(f1.id, actor);
    await deleteMessage({ topicId: topic.id, messageId: msgId }, actor);
    expect(refsOf(msgId)).toEqual([]);

    expect(
      await db.select({ id: files.id }).from(files).where(eq(files.id, f2.id)),
    ).toEqual([]);
  });

  it("reclaims attachments and cascades refs on topic and assistant deletion", async () => {
    const { actor } = await seedActor();
    const secondary = await createAssistant({ name: "Secondary", icon: "📁" }, actor);
    const sharedFile = await uploadFile(
      { filename: "shared.png", mediaType: "image/png", data: Buffer.from("shared") },
      actor,
      { skipSizeLimit: true },
    );
    const topicOnlyFile = await uploadFile(
      { filename: "topic.png", mediaType: "image/png", data: Buffer.from("topic") },
      actor,
      { skipSizeLimit: true },
    );
    const assistantOnlyFile = await uploadFile(
      { filename: "assistant.png", mediaType: "image/png", data: Buffer.from("assistant") },
      actor,
      { skipSizeLimit: true },
    );

    const t1 = await createTopicForChat({ assistantId: secondary.id }, actor, "T1");
    const t2 = await createTopicForChat({ assistantId: secondary.id }, actor, "T2");
    const primaryTopic = await createTopicForChat(
      { assistantId: (await db.select().from(assistants).where(eq(assistants.ownerId, actor.userId)))[0]!.id },
      actor,
      "Keep",
    );

    const t1MessageId = newId();
    const t2MessageId = newId();
    db.insert(chatMessages)
      .values([
        {
          id: newId(),
          topicId: primaryTopic.id,
          role: "user",
          groupId: "g-keep",
          parts: [{ type: "file", url: sharedFile.url }],
        },
        {
          id: t1MessageId,
          topicId: t1.id,
          role: "user",
          groupId: "g-t1",
          parts: [
            { type: "file", url: sharedFile.url },
            { type: "file", url: topicOnlyFile.url },
          ],
        },
        {
          id: t2MessageId,
          topicId: t2.id,
          role: "user",
          groupId: "g-t2",
          parts: [{ type: "file", url: assistantOnlyFile.url }],
        },
      ])
      .run();

    // deleteTopic removes topicOnlyFile but spares sharedFile.
    await deleteTopic(t1.id, actor);
    expect(refsOf(t1MessageId)).toEqual([]);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, topicOnlyFile.id)).all(),
    ).toEqual([]);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, sharedFile.id)).all(),
    ).toHaveLength(1);

    // deleteAssistant removes assistantOnlyFile.
    expect(refsOf(t2MessageId)).toEqual([{ fileId: assistantOnlyFile.id }]);
    await deleteAssistant(secondary.id, actor);
    expect(refsOf(t2MessageId)).toEqual([]);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, assistantOnlyFile.id)).all(),
    ).toEqual([]);

    // Clean up remaining referenced topic so storage leak check finishes empty.
    await deleteTopic(primaryTopic.id, actor);
  });

  it("reads references through message_file_refs indexes, never scanning chat_messages", async () => {
    const { actor, primaryAssistantId } = await seedActor();
    const topic = await createTopicForChat(
      { assistantId: primaryAssistantId },
      actor,
      "Plans",
    );
    const referenced = await uploadFile(
      { filename: "used.png", mediaType: "image/png", data: Buffer.from("used") },
      actor,
      { skipSizeLimit: true },
    );
    const messageId = newId();
    db.insert(chatMessages)
      .values({
        id: messageId,
        topicId: topic.id,
        role: "user",
        groupId: messageId,
        parts: [{ type: "file", url: referenced.url }],
      })
      .run();

    // The statements the services actually run: in-use badge, the
    // isFileReferenced gate of deleteFile, the orphan sweep and the
    // delete-topic/assistant file-id read.
    const statements = [
      ...(await refsQueriesDuring(() => listFilesForActor(actor, { offset: 0, limit: 10 }))),
      ...(await refsQueriesDuring(() =>
        expect(deleteFile(referenced.id, actor)).rejects.toMatchObject({ status: 409 }),
      )),
      ...(await refsQueriesDuring(() => sweepOrphanFiles(actor))),
      ...(await refsQueriesDuring(async () => fileIdsForTopics(db, [topic.id]))),
    ];

    expect(statements).toHaveLength(4);
    for (const statement of statements) {
      const plan = queryPlan(statement);
      expect(plan).not.toMatch(/SCAN chat_messages\b/);
      expect(plan).toMatch(
        /message_file_refs USING (COVERING INDEX message_file_refs_file_idx|PRIMARY KEY)/,
      );
    }

    await deleteTopic(topic.id, actor);
  });
});
