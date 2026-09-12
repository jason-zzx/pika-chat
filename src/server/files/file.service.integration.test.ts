import "server-only";

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  accounts,
  assistants,
  chatMessages,
  files,
  sessions,
  topics,
  users,
  verifications,
} from "@/server/db/schema";
import { deleteMessage } from "@/server/services/message.service";
import { deleteTopic } from "@/server/services/topic.service";
import { buildDocx } from "@test/fixtures/docx";
import {
  buildEncryptedPdf,
  buildScannedPdf,
  buildTextPdf,
} from "@test/fixtures/pdf";

import {
  deleteFile,
  getFileForActor,
  ORPHAN_FILE_TTL_MS,
  readFileForActor,
  resolveOwnedFileParts,
  sweepOrphanFiles,
  uploadFile,
} from "./file.service";
import { getFileStorage } from "./storage";

// Must be set before the first `getEnv()` call (which caches process.env) so
// the storage singleton writes into a throwaway directory.
const storageRoot = join(tmpdir(), `pika-files-it-${process.pid}-${newId()}`);
process.env.FILE_STORAGE_DIR = storageRoot;

const db = getDb();

async function resetState(): Promise<void> {
  await db.delete(files);
  await db.delete(chatMessages);
  await db.delete(topics);
  await db.delete(assistants);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
}

async function seedUser(label: string): Promise<Actor & { id: string }> {
  const id = newId();
  await db.insert(users).values({
    id,
    name: label,
    email: `${label}-${id}@example.com`,
    username: `${label}-${id}`,
  });
  return { userId: id, role: "user", id };
}

type SeedFile = {
  id: string;
  url: string;
  mediaType: string;
  filename: string;
  storageKey: string;
};

function filePart(file: SeedFile) {
  return {
    type: "file" as const,
    url: file.url,
    mediaType: file.mediaType,
    filename: file.filename,
  };
}

async function seedTopicWithMessage(
  actor: Actor,
  parts: unknown[],
): Promise<{ topicId: string; messageId: string }> {
  const assistantId = newId();
  await db.insert(assistants).values({
    id: assistantId,
    ownerId: actor.userId,
    name: `assistant-${assistantId}`,
    icon: "✨",
  });
  const topicId = newId();
  await db.insert(topics).values({ id: topicId, assistantId, title: "Topic" });
  const messageId = newId();
  await db.insert(chatMessages).values({
    id: messageId,
    topicId,
    role: "user",
    parts,
    groupId: messageId,
  });
  return { topicId, messageId };
}

async function uploadText(text: string, actor: Actor): Promise<SeedFile> {
  const uploaded = await uploadFile(
    {
      filename: "notes.txt",
      mediaType: "text/plain",
      data: Buffer.from(text, "utf8"),
    },
    actor,
  );
  return rowFor(uploaded.id, actor);
}

async function rowFor(id: string, actor: Actor): Promise<SeedFile> {
  const row = await getFileForActor(id, actor);
  return {
    id: row.id,
    url: `/api/files/${row.id}`,
    mediaType: row.mediaType,
    filename: row.filename,
    storageKey: row.storageKey,
  };
}

describe("file.service", () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("uploads, extracts, and serves the bytes to its owner only", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const bytes = Buffer.from("hello attachment\nsecond line", "utf8");

    const uploaded = await uploadFile(
      { filename: "notes.txt", mediaType: "text/plain", data: bytes },
      owner,
    );
    expect(uploaded.url).toBe(`/api/files/${uploaded.id}`);
    expect(uploaded.extraction).toEqual({ status: "ok", truncated: false });

    const cached = await db
      .select({
        text: files.extractedText,
        status: files.extractionStatus,
        truncated: files.extractionTruncated,
      })
      .from(files)
      .where(eq(files.id, uploaded.id));
    expect(cached[0]?.status).toBe("ok");
    expect(cached[0]?.text).toContain("hello attachment");
    expect(cached[0]?.truncated).toBe(false);

    const { data } = await readFileForActor(uploaded.id, owner);
    expect(data.equals(bytes)).toBe(true);

    await expect(getFileForActor(uploaded.id, other)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(readFileForActor(uploaded.id, other)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("records images as no-extraction without calling the parser", async () => {
    const owner = await seedUser("owner");
    const uploaded = await uploadFile(
      {
        filename: "pic.png",
        mediaType: "image/png",
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
      owner,
    );
    expect(uploaded.extraction).toEqual({ status: "none", truncated: false });
    const row = await getFileForActor(uploaded.id, owner);
    expect(row.extractionStatus).toBe("none");
    expect(row.extractedText).toBeNull();
  });

  it("infers a text media type when the browser sends none", async () => {
    const owner = await seedUser("owner");
    const uploaded = await uploadFile(
      {
        filename: "README.md",
        mediaType: "",
        data: Buffer.from("# Title\n\nbody"),
      },
      owner,
    );
    expect(uploaded.mediaType).toBe("text/markdown");
    expect(uploaded.extraction.status).toBe("ok");
  });

  it("extracts office documents into cached text", async () => {
    const owner = await seedUser("owner");
    const uploaded = await uploadFile(
      {
        filename: "report.docx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: buildDocx(["Quarterly report", "Revenue up"]),
      },
      owner,
    );
    expect(uploaded.extraction.status).toBe("ok");
    const row = await getFileForActor(uploaded.id, owner);
    expect(row.extractedText).toContain("Quarterly report");
  });

  it("classifies PDFs as ok, empty, and failed without failing the upload", async () => {
    const owner = await seedUser("owner");
    const cases = [
      { name: "text.pdf", data: buildTextPdf("Hello PDF"), status: "ok" },
      { name: "scan.pdf", data: buildScannedPdf(), status: "empty" },
      { name: "locked.pdf", data: buildEncryptedPdf(), status: "failed" },
    ] as const;

    for (const item of cases) {
      const uploaded = await uploadFile(
        { filename: item.name, mediaType: "application/pdf", data: item.data },
        owner,
      );
      expect(uploaded.extraction.status).toBe(item.status);
    }
  });

  it("returns 409 for an in-use file and deletes it once unreferenced", async () => {
    const owner = await seedUser("owner");
    const file = await uploadText("body", owner);
    const { messageId } = await seedTopicWithMessage(owner, [filePart(file)]);

    await expect(deleteFile(file.id, owner)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    await db.delete(chatMessages).where(eq(chatMessages.id, messageId));
    await deleteFile(file.id, owner);

    await expect(getFileForActor(file.id, owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getFileStorage().get(file.storageKey)).rejects.toThrow();
  });

  it("refuses deletion and reads for a non-owner", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const file = await uploadText("private", owner);

    await expect(deleteFile(file.id, other)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Still present for the owner after the failed attempt.
    await expect(getFileForActor(file.id, owner)).resolves.toMatchObject({
      id: file.id,
    });
  });

  it("cleans attachments up when their message is deleted", async () => {
    const owner = await seedUser("owner");
    const file = await uploadText("gone with the message", owner);
    const { topicId, messageId } = await seedTopicWithMessage(owner, [
      filePart(file),
      { type: "text", text: "see file" },
    ]);

    await deleteMessage({ topicId, messageId }, owner);

    const remaining = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.id, file.id));
    expect(remaining).toEqual([]);
    await expect(getFileStorage().get(file.storageKey)).rejects.toThrow();
  });

  it("keeps a file another message still references", async () => {
    const owner = await seedUser("owner");
    const file = await uploadText("shared", owner);
    const first = await seedTopicWithMessage(owner, [filePart(file)]);
    await seedTopicWithMessage(owner, [filePart(file)]);

    await deleteMessage(
      { topicId: first.topicId, messageId: first.messageId },
      owner,
    );

    await expect(getFileForActor(file.id, owner)).resolves.toMatchObject({
      id: file.id,
    });
  });

  it("cleans attachments up when their topic is deleted", async () => {
    const owner = await seedUser("owner");
    const file = await uploadText("topic attachment", owner);
    const { topicId } = await seedTopicWithMessage(owner, [filePart(file)]);

    await deleteTopic(topicId, owner);

    const remaining = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.id, file.id));
    expect(remaining).toEqual([]);
    await expect(getFileStorage().get(file.storageKey)).rejects.toThrow();
  });

  it("sweeps stale unreferenced uploads but keeps referenced ones", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const orphan = await uploadText("orphan", owner);
    const kept = await uploadText("kept", owner);
    const foreign = await uploadText("foreign", other);
    await seedTopicWithMessage(owner, [filePart(kept)]);

    const old = new Date(Date.now() - 2 * ORPHAN_FILE_TTL_MS);
    for (const file of [orphan, kept, foreign]) {
      await db.update(files).set({ createdAt: old }).where(eq(files.id, file.id));
    }

    await sweepOrphanFiles(owner);

    const remaining = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.userId, owner.userId));
    expect(remaining.map((row) => row.id)).toEqual([kept.id]);

    // The sweeper is owner-scoped: another user's orphan is left alone.
    await expect(getFileForActor(foreign.id, other)).resolves.toMatchObject({
      id: foreign.id,
    });
  });
});

describe("resolveOwnedFileParts", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("canonicalizes each part from the stored row", async () => {
    const owner = await seedUser("owner");
    const file = await uploadText("hello", owner);

    const parts = await resolveOwnedFileParts(
      [
        {
          type: "file",
          url: file.url,
          mediaType: file.mediaType,
          // A forged filename is discarded in favour of the stored one.
          filename: "forged.txt",
        },
      ],
      owner,
    );

    expect(parts).toEqual([
      {
        type: "file",
        url: `/api/files/${file.id}`,
        mediaType: "text/plain",
        filename: "notes.txt",
        sizeBytes: 5,
      },
    ]);
  });

  it("rejects a foreign file id as NOT_FOUND", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const file = await uploadText("mine", owner);

    await expect(
      resolveOwnedFileParts(
        [
          {
            type: "file",
            url: file.url,
            mediaType: file.mediaType,
          },
        ],
        other,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      messageKey: "file.notFound",
    });
  });

  it("rejects a declared media type that disagrees with the row", async () => {
    const owner = await seedUser("owner");
    const file = await uploadText("hello", owner);

    await expect(
      resolveOwnedFileParts(
        [{ type: "file", url: file.url, mediaType: "application/pdf" }],
        owner,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.unsupportedType",
    });
  });

  it("rejects more than the per-message attachment limit", async () => {
    const owner = await seedUser("owner");
    const parts = Array.from(
      { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
      (_unused, index) => ({
        type: "file" as const,
        url: `/api/files/f${index}`,
        mediaType: "text/plain",
      }),
    );

    await expect(resolveOwnedFileParts(parts, owner)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.tooMany",
    });
  });
});
