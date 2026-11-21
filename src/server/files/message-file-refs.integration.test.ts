import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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

function explainDetails(query: string, params: unknown[]): string[] {
  const rows = getSqliteClient()
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...params) as Array<{ detail: string }>;
  return rows.map((row) => row.detail);
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
          { type: "text", text: "hello" },
        ],
      })
      .run();

    expect(
      db
        .select({ fileId: messageFileRefs.fileId })
        .from(messageFileRefs)
        .where(eq(messageFileRefs.messageId, msgId))
        .all(),
    ).toEqual([{ fileId: f1.id }]);

    const page1 = await listFilesForActor(actor, { offset: 0, limit: 10 });
    const byId1 = new Map(page1.files.map((row) => [row.id, row.referenced]));
    expect(byId1.get(f1.id)).toBe(true);
    expect(byId1.get(f2.id)).toBe(false);

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

    expect(
      db
        .select({ fileId: messageFileRefs.fileId })
        .from(messageFileRefs)
        .where(eq(messageFileRefs.messageId, msgId))
        .all(),
    ).toEqual([{ fileId: f2.id }]);

    await deleteFile(f1.id, actor);
    await deleteMessage({ topicId: topic.id, messageId: msgId }, actor);

    expect(
      await db.select({ id: files.id }).from(files).where(eq(files.id, f2.id)),
    ).toEqual([]);
  });

  it("reclaims attachments when deleting a topic, deleting an assistant, or sweeping orphans", async () => {
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
    const orphanFile = await uploadFile(
      { filename: "orphan.png", mediaType: "image/png", data: Buffer.from("orphan") },
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
          id: newId(),
          topicId: t1.id,
          role: "user",
          groupId: "g-t1",
          parts: [
            { type: "file", url: sharedFile.url },
            { type: "file", url: topicOnlyFile.url },
          ],
        },
        {
          id: newId(),
          topicId: t2.id,
          role: "user",
          groupId: "g-t2",
          parts: [{ type: "file", url: assistantOnlyFile.url }],
        },
      ])
      .run();

    // Backdate orphan past the 24h TTL so sweepOrphanFiles collects it.
    db.update(files)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(files.id, orphanFile.id))
      .run();
    await sweepOrphanFiles(actor);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, orphanFile.id)).all(),
    ).toEqual([]);

    // deleteTopic removes topicOnlyFile but spares sharedFile.
    await deleteTopic(t1.id, actor);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, topicOnlyFile.id)).all(),
    ).toEqual([]);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, sharedFile.id)).all(),
    ).toHaveLength(1);

    // deleteAssistant removes assistantOnlyFile.
    await deleteAssistant(secondary.id, actor);
    expect(
      db.select({ id: files.id }).from(files).where(eq(files.id, assistantOnlyFile.id)).all(),
    ).toEqual([]);

    // Clean up remaining referenced topic so storage leak check finishes empty.
    await deleteTopic(primaryTopic.id, actor);
  });

  it("uses message_file_refs indexes instead of scanning chat_messages", () => {
    const queries = [
      {
        sql: "SELECT exists (select 1 from message_file_refs where file_id = f.id) FROM files f WHERE f.user_id = ?",
        params: ["u1"],
        expectedIndex: "message_file_refs_file_idx",
      },
      {
        sql: "SELECT file_id FROM message_file_refs WHERE file_id = ? LIMIT 1",
        params: ["f1"],
        expectedIndex: "message_file_refs_file_idx",
      },
      {
        sql: "SELECT id FROM files WHERE user_id = ? AND created_at < ? AND NOT (exists (select 1 from message_file_refs where file_id = files.id))",
        params: ["u1", 1000],
        expectedIndex: "message_file_refs_file_idx",
      },
      {
        sql: "SELECT DISTINCT message_file_refs.file_id FROM message_file_refs INNER JOIN chat_messages ON chat_messages.id = message_file_refs.message_id WHERE chat_messages.topic_id IN (?, ?)",
        params: ["t1", "t2"],
        expectedIndex: "SEARCH message_file_refs USING PRIMARY KEY",
      },
    ];

    for (const query of queries) {
      const details = explainDetails(query.sql, query.params).join(" | ");
      expect(details).not.toMatch(/SCAN\b[^|]*chat_messages\b/i);
      expect(details).toContain(query.expectedIndex);
    }
  });
});
