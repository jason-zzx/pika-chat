import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCX_MEDIA_TYPE,
  PDF_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
} from "@/lib/files/media-types";
import type { ChatFilePart, ChatUIMessage } from "@/lib/schemas/chat";
import type { FileRecord } from "@/server/files/file.service";

const { getFilesByIds, storageGet } = vi.hoisted(() => ({
  getFilesByIds: vi.fn(),
  storageGet: vi.fn(),
}));

vi.mock("@/server/files/file.service", () => ({ getFilesByIds }));
vi.mock("@/server/files/storage", () => ({
  getFileStorage: () => ({ get: storageGet }),
}));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveAttachmentsForModel } from "./attachments";

const actor = "user-1";

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "file-1",
    userId: actor,
    filename: "report.pdf",
    mediaType: PDF_MEDIA_TYPE,
    sizeBytes: 3,
    storageKey: `${actor}/file-1`,
    extractedText: "hello",
    extractionStatus: "ok",
    extractionTruncated: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function filePart(file: FileRecord): ChatFilePart {
  return {
    type: "file",
    url: `/api/files/${file.id}`,
    mediaType: file.mediaType,
    filename: file.filename,
  };
}

function userMessage(parts: ChatUIMessage["parts"]): ChatUIMessage {
  return { id: "m1", role: "user", parts };
}

const ALL_MODALITIES = { inputModalities: ["text", "image", "pdf"] };
const TEXT_ONLY = { inputModalities: ["text"] };

beforeEach(() => {
  getFilesByIds.mockReset();
  storageGet.mockReset();
});

describe("resolveAttachmentsForModel", () => {
  it("returns the same array untouched when nothing is attached", async () => {
    const messages = [userMessage([{ type: "text", text: "hi" }])];

    const routed = await resolveAttachmentsForModel(messages, TEXT_ONLY);

    expect(routed).toBe(messages);
    expect(getFilesByIds).not.toHaveBeenCalled();
  });

  it("inlines an image as a data URL when the model has vision", async () => {
    const file = makeFile({
      id: "img-1",
      filename: "cat.png",
      mediaType: "image/png",
      storageKey: `${actor}/img-1`,
      extractedText: null,
      extractionStatus: "none",
    });
    getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));
    storageGet.mockResolvedValue(Buffer.from("abc"));
    const messages = [
      userMessage([
        { type: "text", text: "what is this?" },
        filePart(file),
      ]),
    ];
    const before = JSON.stringify(messages);

    const routed = await resolveAttachmentsForModel(messages, ALL_MODALITIES);

    expect(routed[0]?.parts[1]).toEqual({
      type: "file",
      url: `data:image/png;base64,${Buffer.from("abc").toString("base64")}`,
      mediaType: "image/png",
      filename: "cat.png",
    });
    // The input (persisted) parts are not mutated.
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("rejects an image when the model has no vision", async () => {
    const file = makeFile({
      id: "img-1",
      filename: "cat.png",
      mediaType: "image/png",
      extractedText: null,
      extractionStatus: "none",
    });
    getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));

    await expect(
      resolveAttachmentsForModel([userMessage([filePart(file)])], TEXT_ONLY),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.imageRequiresVision",
    });
  });

  it("inlines a PDF when the model supports pdf natively", async () => {
    const file = makeFile();
    getFilesByIds.mockResolvedValue(new Map([["file-1", file]]));
    storageGet.mockResolvedValue(Buffer.from("pdf"));

    const routed = await resolveAttachmentsForModel(
      [userMessage([filePart(file)])],
      ALL_MODALITIES,
    );

    expect(routed[0]?.parts[0]).toMatchObject({
      type: "file",
      mediaType: PDF_MEDIA_TYPE,
      url: `data:application/pdf;base64,${Buffer.from("pdf").toString("base64")}`,
    });
    expect(storageGet).toHaveBeenCalledWith(`${actor}/file-1`);
  });

  it("degrades a PDF to its cached extraction for a text-only model", async () => {
    const file = makeFile({ extractedText: "page one", extractionTruncated: true });
    getFilesByIds.mockResolvedValue(new Map([["file-1", file]]));

    const routed = await resolveAttachmentsForModel(
      [userMessage([filePart(file)])],
      TEXT_ONLY,
    );

    expect(routed[0]?.parts).toEqual([
      {
        type: "text",
        text: '<attachment filename="report.pdf" truncated="true">\npage one\n</attachment>',
      },
    ]);
    // The degraded path never touches object storage.
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("rejects a scanned PDF (empty text layer) the model cannot read natively", async () => {
    const file = makeFile({ extractionStatus: "empty", extractedText: null });
    getFilesByIds.mockResolvedValue(new Map([["file-1", file]]));

    await expect(
      resolveAttachmentsForModel([userMessage([filePart(file)])], TEXT_ONLY),
    ).rejects.toMatchObject({
      status: 400,
      messageKey: "file.noTextLayer",
    });
  });

  it("rejects a corrupt PDF as unreadable", async () => {
    const file = makeFile({ extractionStatus: "failed", extractedText: null });
    getFilesByIds.mockResolvedValue(new Map([["file-1", file]]));

    await expect(
      resolveAttachmentsForModel([userMessage([filePart(file)])], TEXT_ONLY),
    ).rejects.toMatchObject({ status: 400, messageKey: "file.unreadable" });
  });

  it("always extracts office documents, even for a model that supports pdf", async () => {
    const file = makeFile({
      id: "doc-1",
      filename: "notes.docx",
      mediaType: DOCX_MEDIA_TYPE,
      extractedText: "Title\n\nBody",
    });
    getFilesByIds.mockResolvedValue(new Map([["doc-1", file]]));

    const routed = await resolveAttachmentsForModel(
      [userMessage([filePart(file)])],
      ALL_MODALITIES,
    );

    expect(routed[0]?.parts[0]).toEqual({
      type: "text",
      text: '<attachment filename="notes.docx" truncated="false">\nTitle\n\nBody\n</attachment>',
    });
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("rejects an empty spreadsheet as no text layer", async () => {
    const file = makeFile({
      id: "sheet-1",
      filename: "book.xlsx",
      mediaType: XLSX_MEDIA_TYPE,
      extractionStatus: "empty",
      extractedText: null,
    });
    getFilesByIds.mockResolvedValue(new Map([["sheet-1", file]]));

    await expect(
      resolveAttachmentsForModel([userMessage([filePart(file)])], TEXT_ONLY),
    ).rejects.toMatchObject({ messageKey: "file.noTextLayer" });
  });

  it("allows an empty text file through (no false 'no text layer')", async () => {
    const file = makeFile({
      id: "txt-1",
      filename: "notes.txt",
      mediaType: "text/plain",
      extractionStatus: "empty",
      extractedText: null,
    });
    getFilesByIds.mockResolvedValue(new Map([["txt-1", file]]));

    const routed = await resolveAttachmentsForModel(
      [userMessage([filePart(file)])],
      TEXT_ONLY,
    );

    expect(routed[0]?.parts[0]).toEqual({
      type: "text",
      text: '<attachment filename="notes.txt" truncated="false">\n\n</attachment>',
    });
  });

  it("rejects an unreadable text file", async () => {
    const file = makeFile({
      id: "txt-1",
      filename: "notes.txt",
      mediaType: "text/plain",
      extractionStatus: "failed",
      extractedText: null,
    });
    getFilesByIds.mockResolvedValue(new Map([["txt-1", file]]));

    await expect(
      resolveAttachmentsForModel([userMessage([filePart(file)])], TEXT_ONLY),
    ).rejects.toMatchObject({ messageKey: "file.unreadable" });
  });

  it("fails loudly when a referenced file row is gone", async () => {
    getFilesByIds.mockResolvedValue(new Map());

    await expect(
      resolveAttachmentsForModel(
        [
          userMessage([
            {
              type: "file",
              url: "/api/files/missing",
              mediaType: PDF_MEDIA_TYPE,
              filename: "gone.pdf",
            },
          ]),
        ],
        TEXT_ONLY,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404, messageKey: "file.notFound" });
  });

  it("batches row and byte reads and dedupes repeated ids", async () => {
    const file = makeFile({
      id: "img-1",
      filename: "cat.png",
      mediaType: "image/png",
      storageKey: `${actor}/img-1`,
      extractionStatus: "none",
      extractedText: null,
    });
    getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));
    storageGet.mockResolvedValue(Buffer.from("abc"));

    await resolveAttachmentsForModel(
      [
        userMessage([filePart(file), filePart(file)]),
        userMessage([filePart(file)]),
      ],
      ALL_MODALITIES,
    );

    expect(getFilesByIds).toHaveBeenCalledTimes(1);
    expect(getFilesByIds).toHaveBeenCalledWith(["img-1"]);
    expect(storageGet).toHaveBeenCalledTimes(1);
  });

  it("re-routes every historical attachment and leaves text-only messages alone", async () => {
    const file = makeFile({ extractedText: "old pdf" });
    getFilesByIds.mockResolvedValue(new Map([["file-1", file]]));
    const textOnly = userMessage([{ type: "text", text: "plain" }]);
    const withFile = userMessage([filePart(file)]);

    const routed = await resolveAttachmentsForModel(
      [textOnly, withFile],
      TEXT_ONLY,
    );

    expect(routed[0]).toBe(textOnly);
    expect(routed[1]).not.toBe(withFile);
    expect(routed[1]?.parts[0]).toMatchObject({ type: "text" });
  });
});
