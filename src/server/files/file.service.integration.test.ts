import "server-only";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib/id";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import {
  FILE_LIST_CATEGORIES,
  fileListCategoryOf,
} from "@/lib/files/media-types";
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
  listFilesForActor,
  ORPHAN_FILE_TTL_MS,
  resolveOwnedFileParts,
  sweepOrphanFiles,
  uploadFile,
} from "./file.service";
import { maxFileBytes } from "./limits";
import { getFileStorage } from "./storage";

// Attachment bytes are served by the shared in-memory FileStorage fake
// (vitest.integration.storage.ts); the leak invariant there requires every
// test to delete the objects it uploaded.
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

async function insertFileRow(
  actor: Actor,
  input: {
    filename: string;
    mediaType: string;
    sizeBytes: number;
    createdAt: Date;
  },
): Promise<string> {
  const id = newId();
  await db.insert(files).values({
    id,
    userId: actor.userId,
    filename: input.filename,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    storageKey: `${actor.userId}/${id}`,
    createdAt: input.createdAt,
  });
  return id;
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

    const row = await getFileForActor(uploaded.id, owner);
    const data = await getFileStorage().get(row.storageKey);
    expect(data.equals(bytes)).toBe(true);

    await expect(getFileForActor(uploaded.id, other)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    // Balance the put from `uploadFile` (the shared leak invariant).
    await deleteFile(uploaded.id, owner);
  });

  it("stores server-generated bytes above the upload cap only when the size limit is skipped", async () => {
    const owner = await seedUser("owner");
    const data = Buffer.alloc(maxFileBytes() + 1, 1);

    // The default path still enforces the per-file cap…
    await expect(
      uploadFile(
        { filename: "generated.png", mediaType: "image/png", data },
        owner,
      ),
    ).rejects.toMatchObject({ messageKey: "file.tooLarge" });

    // …while a generated image (4K renders outgrow the cap) lands whole.
    const uploaded = await uploadFile(
      { filename: "generated.png", mediaType: "image/png", data },
      owner,
      { skipSizeLimit: true },
    );
    expect(uploaded.sizeBytes).toBe(data.byteLength);
    const row = await getFileForActor(uploaded.id, owner);
    expect(row.sizeBytes).toBe(data.byteLength);

    // Balance the put from `uploadFile` (the shared leak invariant).
    await deleteFile(uploaded.id, owner);
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
    await deleteFile(uploaded.id, owner);
  });

  it("records audio and video as no-extraction (no transcription path)", async () => {
    const owner = await seedUser("owner");
    for (const [filename, mediaType] of [
      ["clip.mp3", "audio/mpeg"],
      ["clip.mp4", "video/mp4"],
    ] as const) {
      const uploaded = await uploadFile(
        { filename, mediaType, data: Buffer.from([0x00, 0x01, 0x02]) },
        owner,
      );
      expect(uploaded.extraction).toEqual({ status: "none", truncated: false });
      const row = await getFileForActor(uploaded.id, owner);
      expect(row.extractionStatus).toBe("none");
      expect(row.extractedText).toBeNull();
      await deleteFile(uploaded.id, owner);
    }
  });

  it("infers a media type from the extension when the browser sends none", async () => {
    const owner = await seedUser("owner");
    const uploaded = await uploadFile(
      {
        filename: "voice.m4a",
        mediaType: "",
        data: Buffer.from([0x00, 0x01, 0x02]),
      },
      owner,
    );
    // Not text/plain: the stored type drives both the download response and
    // the native-transmission route.
    expect(uploaded.mediaType).toBe("audio/mp4");
    expect(uploaded.extraction.status).toBe("none");
    await deleteFile(uploaded.id, owner);
  });

  it("infers a media type when the browser sends a generic binary type", async () => {
    const owner = await seedUser("owner");
    const uploaded = await uploadFile(
      {
        filename: "clip.mp4",
        mediaType: "application/octet-stream",
        data: Buffer.from([0x00, 0x01, 0x02]),
      },
      owner,
    );
    // Mobile pickers report the octet-stream placeholder for media. Storing it
    // would let the upload through (classification falls back to the
    // extension) and then fail every send on a type no endpoint can serialize.
    expect(uploaded.mediaType).toBe("video/mp4");
    expect(uploaded.extraction.status).toBe("none");
    await deleteFile(uploaded.id, owner);
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
    await deleteFile(uploaded.id, owner);
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
    await deleteFile(uploaded.id, owner);
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
      await deleteFile(uploaded.id, owner);
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
    await deleteFile(file.id, owner);
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
    const second = await seedTopicWithMessage(owner, [filePart(file)]);

    await deleteMessage(
      { topicId: first.topicId, messageId: first.messageId },
      owner,
    );

    await expect(getFileForActor(file.id, owner)).resolves.toMatchObject({
      id: file.id,
    });

    // Balance the put: dropping the last referencing message cascades the
    // file (row and object) away on its own.
    await deleteMessage(
      { topicId: second.topicId, messageId: second.messageId },
      owner,
    );
    await expect(getFileForActor(file.id, owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
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
    const { topicId: keptTopicId } = await seedTopicWithMessage(owner, [
      filePart(kept),
    ]);

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

    // Balance the puts: `kept` is still referenced, so drop its message
    // first; `foreign` is an unreferenced orphan.
    await db.delete(chatMessages).where(eq(chatMessages.topicId, keptTopicId));
    await deleteFile(kept.id, owner);
    await deleteFile(foreign.id, other);
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
    await deleteFile(file.id, owner);
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
    await deleteFile(file.id, owner);
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
    await deleteFile(file.id, owner);
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

describe("listFilesForActor", () => {
  beforeEach(async () => {
    await resetState();
  });

  it("pages newest-first with a filtered count and full-usage bytes", async () => {
    const owner = await seedUser("owner");
    for (let index = 0; index < 5; index += 1) {
      await insertFileRow(owner, {
        filename: `f${index}.txt`,
        mediaType: "text/plain",
        sizeBytes: 100 * (index + 1),
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      });
    }

    const firstPage = await listFilesForActor(owner, { offset: 0, limit: 2 });
    expect(firstPage.files.map((file) => file.filename)).toEqual([
      "f4.txt",
      "f3.txt",
    ]);
    expect(firstPage.totalCount).toBe(5);
    expect(firstPage.totalBytes).toBe(1500);
    expect(firstPage.files[0]).toMatchObject({
      sizeBytes: 500,
      extractionStatus: "none",
      referenced: false,
    });
    expect(firstPage.files[0]?.createdAt).toBe(
      new Date(Date.UTC(2026, 0, 5)).toISOString(),
    );

    const lastPage = await listFilesForActor(owner, { offset: 4, limit: 2 });
    expect(lastPage.files.map((file) => file.filename)).toEqual(["f0.txt"]);
    expect(lastPage.totalCount).toBe(5);

    // Limit is clamped to the hard ceiling rather than rejected.
    const clamped = await listFilesForActor(owner, { offset: 0, limit: 1000 });
    expect(clamped.files).toHaveLength(5);

    // An offset past the end still reports the real filtered total.
    const beyond = await listFilesForActor(owner, { offset: 50, limit: 2 });
    expect(beyond.files).toEqual([]);
    expect(beyond.totalCount).toBe(5);
  });

  it("never lists another user's files and counts only the actor's bytes", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    const mine = await insertFileRow(owner, {
      filename: "mine.txt",
      mediaType: "text/plain",
      sizeBytes: 10,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });
    const foreign = await insertFileRow(other, {
      filename: "theirs.txt",
      mediaType: "text/plain",
      sizeBytes: 999,
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });

    const page = await listFilesForActor(owner, { offset: 0, limit: 50 });
    expect(page.files.map((file) => file.id)).toEqual([mine]);
    expect(page.totalCount).toBe(1);
    expect(page.totalBytes).toBe(10);
    expect(page.files.some((file) => file.id === foreign)).toBe(false);
  });

  it("marks a file referenced by a persisted message", async () => {
    const owner = await seedUser("owner");
    const referenced = await insertFileRow(owner, {
      filename: "used.txt",
      mediaType: "text/plain",
      sizeBytes: 4,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });
    const free = await insertFileRow(owner, {
      filename: "free.txt",
      mediaType: "text/plain",
      sizeBytes: 4,
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });
    await seedTopicWithMessage(owner, [
      {
        type: "file",
        url: `/api/files/${referenced}`,
        mediaType: "text/plain",
        filename: "used.txt",
      },
    ]);

    const page = await listFilesForActor(owner, { offset: 0, limit: 50 });
    const byId = new Map(page.files.map((file) => [file.id, file]));
    expect(byId.get(referenced)?.referenced).toBe(true);
    expect(byId.get(free)?.referenced).toBe(false);
  });

  it("keeps totalBytes unfiltered when a category is selected", async () => {
    const owner = await seedUser("owner");
    await insertFileRow(owner, {
      filename: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 3,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await insertFileRow(owner, {
      filename: "clip.mp4",
      mediaType: "video/mp4",
      sizeBytes: 5,
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });

    const page = await listFilesForActor(owner, {
      offset: 0,
      limit: 50,
      category: "video",
    });
    // Usage is not filter-scoped: the card's denominator stays whole.
    expect(page.totalBytes).toBe(8);
  });

  it("filters by exactly the category each row's badge shows", async () => {
    const owner = await seedUser("owner");
    // Includes the browser-declared drift cases that used to split the badge
    // (`classifyFile`) from the filter (a hand-kept media-type list): an
    // octet-stream/mis-declared type whose extension carries the real format,
    // and `text/*`/`application/json` names a browser typed as audio/video.
    const rows: { filename: string; mediaType: string }[] = [
      // images
      { filename: "pic.png", mediaType: "image/png" },
      { filename: "photo", mediaType: "image/jpeg" },
      { filename: "shot.gif", mediaType: "image/gif" },
      { filename: "art.webp", mediaType: "image/webp" },
      // documents by media type
      { filename: "report.pdf", mediaType: "application/pdf" },
      {
        filename: "doc.docx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      {
        filename: "sheet.xlsx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      {
        filename: "slides.pptx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      { filename: "book.epub", mediaType: "application/epub+zip" },
      { filename: "notes.txt", mediaType: "text/plain" },
      { filename: "data.json", mediaType: "text/plain" },
      { filename: "config.yaml", mediaType: "application/yaml" },
      { filename: "style.css", mediaType: "text/css" },
      // documents the browser declared as a generic binary
      { filename: "readme.md", mediaType: "application/octet-stream" },
      { filename: "deck.pptx", mediaType: "application/octet-stream" },
      { filename: "book2.epub", mediaType: "application/octet-stream" },
      { filename: "loose.txt", mediaType: "application/octet-stream" },
      { filename: "script.py", mediaType: "application/x-python" },
      { filename: "app.ts", mediaType: "video/mp2t" },
      { filename: "Makefile", mediaType: "application/octet-stream" },
      { filename: ".gitignore", mediaType: "application/octet-stream" },
      // audio
      { filename: "song.mp3", mediaType: "audio/mpeg" },
      { filename: "voice.wav", mediaType: "audio/wav" },
      { filename: "track.m4a", mediaType: "audio/mp4" },
      { filename: "tune.flac", mediaType: "audio/flac" },
      { filename: "beep.mp3", mediaType: "application/octet-stream" },
      { filename: "call.ogg", mediaType: "application/octet-stream" },
      // video
      { filename: "clip.mp4", mediaType: "video/mp4" },
      { filename: "screen.webm", mediaType: "video/webm" },
      { filename: "take.mov", mediaType: "video/quicktime" },
      { filename: "trailer.mp4", mediaType: "application/octet-stream" },
      { filename: "render.webm", mediaType: "application/octet-stream" },
      // a recognized media type must beat a misleading extension
      { filename: "audio-source.ts", mediaType: "audio/mpeg" },
      { filename: "typed.mp4", mediaType: "audio/mpeg" },
      { filename: "notes.txt", mediaType: "video/mp4" },
      // a `text/*`/`application/json` name with an audio/video extension is
      // audio/video, not a document
      { filename: "clip.mp4", mediaType: "text/plain" },
      { filename: "movie.mp4", mediaType: "application/json" },
      { filename: "voice.mp3", mediaType: "text/plain" },
      // unsupported: badge is null, so it appears only under "all"
      { filename: "archive.zip", mediaType: "application/zip" },
      { filename: "weird.ppt", mediaType: "application/octet-stream" },
      { filename: "no-extension", mediaType: "application/json" },
      { filename: "image.jpg", mediaType: "application/x-unknown" },
    ];
    const seeded: { id: string; filename: string; mediaType: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const id = await insertFileRow(owner, {
        filename: row.filename,
        mediaType: row.mediaType,
        sizeBytes: index + 1,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      });
      seeded.push({ id, ...row });
    }

    // Compare by id, not by filename: two rows may share a filename and differ
    // only by media type (`notes.txt` as document vs. video), so a
    // filename-keyed assertion could be satisfied by the pair swapping places.
    // Filenames ride along purely so a failure diff names the rows.
    const expectedByCategory = new Map<
      string,
      { id: string; filename: string }[]
    >();
    for (const category of FILE_LIST_CATEGORIES) {
      expectedByCategory.set(category, []);
    }
    for (const row of seeded) {
      const category = fileListCategoryOf(row);
      if (category !== null) {
        expectedByCategory
          .get(category)!
          .push({ id: row.id, filename: row.filename });
      }
    }

    for (const category of FILE_LIST_CATEGORIES) {
      const page = await listFilesForActor(owner, {
        offset: 0,
        limit: 100,
        category,
      });
      const expected = [...expectedByCategory.get(category)!].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const actual = page.files
        .map(({ id, filename }) => ({ id, filename }))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(actual).toEqual(expected);
      expect(page.totalCount).toBe(expected.length);
    }

    // Every row — including the ones no filter claims — is still listed.
    const all = await listFilesForActor(owner, { offset: 0, limit: 100 });
    expect(all.totalCount).toBe(rows.length);
  });
});
