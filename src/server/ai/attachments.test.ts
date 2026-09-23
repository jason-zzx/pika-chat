import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUDIO_MEDIA_TYPES,
  DOCX_MEDIA_TYPE,
  EPUB_MEDIA_TYPE,
  normalizeMediaType,
  PDF_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
} from "@/lib/files/media-types";
import type { ChatFilePart, ChatUIMessage } from "@/lib/schemas/chat";
import type { AttachmentCapabilities } from "@/server/ai/attachments";
import type { FileRecord } from "@/server/files/file.service";

const { getFilesByIds, storageGet, ensureProviderReference } = vi.hoisted(
  () => ({
    getFilesByIds: vi.fn(),
    storageGet: vi.fn(),
    ensureProviderReference: vi.fn(),
  }),
);

vi.mock("@/server/files/file.service", () => ({
  getFilesByIds,
  fileUrl: (id: string) => `/api/files/${id}`,
}));
vi.mock("@/server/files/storage", () => ({
  getFileStorage: () => ({ get: storageGet }),
}));
vi.mock("@/server/ai/provider-files", () => ({ ensureProviderReference }));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createFilesApi, type FilesApiProvider } from "@/server/ai/provider-factory";

import { resolveAttachmentsForModel } from "./attachments";

const actor = "user-1";

/** A real provider instance; `ensureProviderReference` is mocked, so it is
 * only ever passed through. */
function filesApi(
  apiFormat: "google" | "claude" = "google",
): FilesApiProvider {
  const api = createFilesApi({
    apiFormat,
    name: apiFormat,
    baseUrl:
      apiFormat === "google"
        ? "https://example.test/v1beta"
        : "https://example.test/v1",
    apiKey: "key",
  });
  if (api === null) {
    throw new Error(`expected ${apiFormat} to expose a files api`);
  }
  return api;
}

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
    providerReferences: {},
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

// openai-compatible has no Files API: every attachment stays inline.
const ALL_MODALITIES = {
  inputModalities: ["text", "image", "pdf"],
  apiFormat: "openai-compatible",
  providerConfigId: "cfg-1",
  filesApi: null,
} satisfies AttachmentCapabilities;
const TEXT_ONLY = { ...ALL_MODALITIES, inputModalities: ["text"] } satisfies AttachmentCapabilities;

/** google/claude: the router may ask for a provider reference. */
const REFERENCE_CAPABLE = {
  ...ALL_MODALITIES,
  apiFormat: "google",
  filesApi: filesApi(),
} satisfies AttachmentCapabilities;

/** A Gemini-style model: declares every modality google can serialize. */
const MEDIA_CAPABLE = {
  ...ALL_MODALITIES,
  inputModalities: ["text", "image", "pdf", "audio", "video"],
  apiFormat: "google",
  filesApi: filesApi(),
} satisfies AttachmentCapabilities;

/** Same model declaration behind a claude endpoint: no audio/video part at
 * all on the wire, so the serialization gate must reject everything. */
const CLAUDE_MEDIA = {
  ...MEDIA_CAPABLE,
  apiFormat: "claude",
  filesApi: filesApi("claude"),
} satisfies AttachmentCapabilities;

/** openai-compatible: `input_audio` for wav/mp3 only, no video whatsoever. */
const OPENAI_AUDIO = {
  ...ALL_MODALITIES,
  inputModalities: ["text", "image", "pdf", "audio", "video"],
  apiFormat: "openai-compatible",
  filesApi: null,
} satisfies AttachmentCapabilities;

/** Audio/video are never extracted, so a media row carries no text cache. */
function makeMedia(
  id: string,
  filename: string,
  mediaType: string,
): FileRecord {
  return makeFile({
    id,
    filename,
    mediaType,
    storageKey: `${actor}/${id}`,
    extractedText: null,
    extractionStatus: "none",
  });
}

beforeEach(() => {
  getFilesByIds.mockReset();
  storageGet.mockReset();
  ensureProviderReference.mockReset();
  ensureProviderReference.mockResolvedValue({ kind: "fallback" });
});

describe("resolveAttachmentsForModel", () => {
  it("returns the same array untouched when nothing is attached", async () => {
    const messages = [userMessage([{ type: "text", text: "hi" }])];

    const routed = await resolveAttachmentsForModel(messages, TEXT_ONLY);

    expect(routed).toBe(messages);
    expect(getFilesByIds).not.toHaveBeenCalled();
  });

  describe("assistant-role file parts (generated images)", () => {
    function assistantMessage(parts: ChatUIMessage["parts"]): ChatUIMessage {
      return { id: "a1", role: "assistant", parts };
    }

    function generatedImagePart(id = "gen-1"): ChatFilePart {
      return {
        type: "file",
        url: `/api/files/${id}`,
        mediaType: "image/png",
        filename: "generated.png",
        sizeBytes: 123,
      };
    }

    it("drops them for a text-only model instead of 400ing every later turn", async () => {
      // A mixed-model topic: the image was generated earlier, the composer is
      // now on a non-vision chat model. Routing the persisted assistant image
      // part would throw file.imageRequiresVision on every send.
      const messages = [
        userMessage([{ type: "text", text: "draw a cat" }]),
        assistantMessage([generatedImagePart(), { type: "text", text: "done" }]),
        userMessage([{ type: "text", text: "now describe it" }]),
      ];
      const before = JSON.stringify(messages);

      const routed = await resolveAttachmentsForModel(messages, TEXT_ONLY);

      expect(routed).toHaveLength(3);
      expect(routed[1]?.parts).toEqual([{ type: "text", text: "done" }]);
      // The generated row is never even looked up, and the input (persisted)
      // parts are not mutated.
      expect(getFilesByIds).not.toHaveBeenCalled();
      expect(JSON.stringify(messages)).toBe(before);
    });

    it("drops them for a google vision model without touching the Files API", async () => {
      // The google adapter cannot serialize an assistant-role image part and
      // throws UnsupportedFunctionalityError on every replayed turn.
      const messages = [
        assistantMessage([generatedImagePart()]),
        userMessage([{ type: "text", text: "next" }]),
      ];

      const routed = await resolveAttachmentsForModel(messages, MEDIA_CAPABLE);

      // The image-only assistant turn collapses entirely: an empty assistant
      // message must not reach the provider either.
      expect(routed).toEqual([messages[1]]);
      expect(ensureProviderReference).not.toHaveBeenCalled();
      expect(storageGet).not.toHaveBeenCalled();
    });

    it("still routes user attachments in the same history", async () => {
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
        assistantMessage([generatedImagePart()]),
        userMessage([filePart(file)]),
      ];

      const routed = await resolveAttachmentsForModel(messages, ALL_MODALITIES);

      expect(routed).toHaveLength(1);
      expect(routed[0]?.parts[0]).toMatchObject({
        type: "file",
        url: expect.stringContaining("data:image/png;base64,"),
      });
    });
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

  it("always extracts ebooks, even for a model that supports pdf", async () => {
    const file = makeFile({
      id: "book-1",
      filename: "novel.epub",
      mediaType: EPUB_MEDIA_TYPE,
      extractedText: "# Chapter One\n\nIt began.",
    });
    getFilesByIds.mockResolvedValue(new Map([["book-1", file]]));

    const routed = await resolveAttachmentsForModel(
      [userMessage([filePart(file)])],
      ALL_MODALITIES,
    );

    expect(routed[0]?.parts[0]).toEqual({
      type: "text",
      text: '<attachment filename="novel.epub" truncated="false">\n# Chapter One\n\nIt began.\n</attachment>',
    });
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("rejects an ebook without any text as no text layer", async () => {
    const file = makeFile({
      id: "book-2",
      filename: "novel.epub",
      mediaType: EPUB_MEDIA_TYPE,
      extractionStatus: "empty",
      extractedText: null,
    });
    getFilesByIds.mockResolvedValue(new Map([["book-2", file]]));

    await expect(
      resolveAttachmentsForModel([userMessage([filePart(file)])], TEXT_ONLY),
    ).rejects.toMatchObject({ messageKey: "file.noTextLayer" });
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

  describe("provider reference transport", () => {
    function makeImage(): FileRecord {
      return makeFile({
        id: "img-1",
        filename: "cat.png",
        mediaType: "image/png",
        storageKey: `${actor}/img-1`,
        extractedText: null,
        extractionStatus: "none",
      });
    }

    it("sends a reference and keeps the canonical url on the part", async () => {
      const file = makeImage();
      getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));
      ensureProviderReference.mockResolvedValue({
        kind: "reference",
        reference: { google: "files/abc" },
      });

      const routed = await resolveAttachmentsForModel(
        [userMessage([filePart(file)])],
        REFERENCE_CAPABLE,
      );

      expect(routed[0]?.parts[0]).toEqual({
        type: "file",
        url: "/api/files/img-1",
        mediaType: "image/png",
        filename: "cat.png",
        providerReference: { google: "files/abc" },
      });
      // No bytes are read at all when a reference carries the turn.
      expect(storageGet).not.toHaveBeenCalled();
    });

    it("inlines the bytes when the reference path falls back", async () => {
      const file = makeImage();
      getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));
      storageGet.mockResolvedValue(Buffer.from("abc"));
      ensureProviderReference.mockResolvedValue({ kind: "fallback" });

      const routed = await resolveAttachmentsForModel(
        [userMessage([filePart(file)])],
        REFERENCE_CAPABLE,
      );

      expect(routed[0]?.parts[0]).toEqual({
        type: "file",
        url: `data:image/png;base64,${Buffer.from("abc").toString("base64")}`,
        mediaType: "image/png",
        filename: "cat.png",
      });
      expect(storageGet).toHaveBeenCalledWith(`${actor}/img-1`);
    });

    it("never asks for a reference when the format has no files api", async () => {
      const file = makeImage();
      getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));
      storageGet.mockResolvedValue(Buffer.from("abc"));

      const routed = await resolveAttachmentsForModel(
        [userMessage([filePart(file)])],
        ALL_MODALITIES,
      );

      expect(ensureProviderReference).not.toHaveBeenCalled();
      expect(routed[0]?.parts[0]).toMatchObject({
        type: "file",
        url: expect.stringContaining("base64,"),
      });
    });

    it("never asks for a reference for an attachment routed to extracted text", async () => {
      const file = makeFile({ extractedText: "page one" });
      getFilesByIds.mockResolvedValue(new Map([["file-1", file]]));

      await resolveAttachmentsForModel(
        [userMessage([filePart(file)])],
        { ...REFERENCE_CAPABLE, inputModalities: ["text"] },
      );

      expect(ensureProviderReference).not.toHaveBeenCalled();
      expect(storageGet).not.toHaveBeenCalled();
    });

    it("resolves one reference per file across repeated parts", async () => {
      const file = makeImage();
      getFilesByIds.mockResolvedValue(new Map([["img-1", file]]));
      ensureProviderReference.mockResolvedValue({
        kind: "reference",
        reference: { google: "files/abc" },
      });

      await resolveAttachmentsForModel(
        [
          userMessage([filePart(file), filePart(file)]),
          userMessage([filePart(file)]),
        ],
        REFERENCE_CAPABLE,
      );

      expect(ensureProviderReference).toHaveBeenCalledTimes(1);
      expect(ensureProviderReference).toHaveBeenCalledWith({
        file,
        configId: REFERENCE_CAPABLE.providerConfigId,
        apiFormat: REFERENCE_CAPABLE.apiFormat,
        filesApi: REFERENCE_CAPABLE.filesApi,
      });
    });
  });

  describe("audio/video native pass-through", () => {
    const MP3 = makeMedia("audio-1", "clip.mp3", "audio/mpeg");
    const M4A = makeMedia("audio-2", "voice.m4a", "audio/mp4");
    const WAV = makeMedia("audio-3", "voice.wav", "audio/wav");
    const MP4 = makeMedia("video-1", "clip.mp4", "video/mp4");

    function stage(file: FileRecord): ChatUIMessage[] {
      getFilesByIds.mockResolvedValue(new Map([[file.id, file]]));
      return [userMessage([filePart(file)])];
    }

    async function expectMediaUnsupported(
      file: FileRecord,
      caps: AttachmentCapabilities,
    ): Promise<void> {
      await expect(
        resolveAttachmentsForModel(stage(file), caps),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        messageKey: "file.mediaUnsupported",
      });
      // The turn aborts before anything is read: no bytes, no upload attempt,
      // and no degraded text part (media is never extracted).
      expect(storageGet).not.toHaveBeenCalled();
      expect(ensureProviderReference).not.toHaveBeenCalled();
    }

    it("sends audio natively when the model declares audio", async () => {
      storageGet.mockResolvedValue(Buffer.from("sound"));

      const routed = await resolveAttachmentsForModel(
        stage(MP3),
        MEDIA_CAPABLE,
      );

      expect(routed[0]?.parts[0]).toEqual({
        type: "file",
        url: `data:audio/mpeg;base64,${Buffer.from("sound").toString("base64")}`,
        mediaType: "audio/mpeg",
        filename: "clip.mp3",
      });
      expect(storageGet).toHaveBeenCalledWith(`${actor}/audio-1`);
    });

    it("sends video natively when the model declares video", async () => {
      storageGet.mockResolvedValue(Buffer.from("frames"));

      const routed = await resolveAttachmentsForModel(
        stage(MP4),
        MEDIA_CAPABLE,
      );

      expect(routed[0]?.parts[0]).toMatchObject({
        type: "file",
        mediaType: "video/mp4",
        url: `data:video/mp4;base64,${Buffer.from("frames").toString("base64")}`,
      });
    });

    it("carries media on a provider reference when one resolves", async () => {
      ensureProviderReference.mockResolvedValue({
        kind: "reference",
        reference: { google: "files/clip" },
      });

      const routed = await resolveAttachmentsForModel(
        stage(MP4),
        MEDIA_CAPABLE,
      );

      expect(routed[0]?.parts[0]).toEqual({
        type: "file",
        url: "/api/files/video-1",
        mediaType: "video/mp4",
        filename: "clip.mp4",
        providerReference: { google: "files/clip" },
      });
      expect(storageGet).not.toHaveBeenCalled();
    });

    it("rejects media when the model does not declare the modality", async () => {
      await expectMediaUnsupported(MP3, {
        ...MEDIA_CAPABLE,
        inputModalities: ["text", "image", "pdf", "video"],
      });
      await expectMediaUnsupported(MP4, {
        ...MEDIA_CAPABLE,
        inputModalities: ["text", "image", "pdf", "audio"],
      });
    });

    it("rejects every media type on claude, which serializes none", async () => {
      // The model declares both modalities; the wire format is what fails.
      await expectMediaUnsupported(MP3, CLAUDE_MEDIA);
      await expectMediaUnsupported(MP4, CLAUDE_MEDIA);
    });

    it("accepts wav and mp3 on openai-compatible", async () => {
      storageGet.mockResolvedValue(Buffer.from("pcm"));

      for (const file of [WAV, MP3]) {
        const routed = await resolveAttachmentsForModel(
          stage(file),
          OPENAI_AUDIO,
        );
        expect(routed[0]?.parts[0]).toMatchObject({
          type: "file",
          url: expect.stringContaining("base64,"),
        });
      }
      // openai-compatible has no Files API: the format never offers one.
      expect(ensureProviderReference).not.toHaveBeenCalled();
    });

    it("rejects m4a on openai-compatible rather than reaching the SDK", async () => {
      // The SDK would raise an opaque UnsupportedFunctionality for a container
      // `input_audio` cannot express; the router has to say so first.
      await expectMediaUnsupported(M4A, OPENAI_AUDIO);
    });

    it("rejects any video on openai-compatible", async () => {
      await expectMediaUnsupported(MP4, OPENAI_AUDIO);
    });

    it("gates every whitelisted audio type on openai-compatible", async () => {
      // `input_audio` only expresses wav and mp3/mpeg; every other whitelist
      // entry must be refused here rather than handed to the SDK. The part
      // that passes carries the *normalized* type (`audio/x-wav` folds onto
      // `audio/wav`, which is the only spelling the wire format knows).
      const serializable = [
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
      ];
      for (const mediaType of AUDIO_MEDIA_TYPES) {
        const file = makeMedia("audio-x", "clip", mediaType);
        storageGet.mockResolvedValue(Buffer.from("sound"));
        if (serializable.includes(mediaType)) {
          const routed = await resolveAttachmentsForModel(
            stage(file),
            OPENAI_AUDIO,
          );
          expect(routed[0]?.parts[0]).toMatchObject({
            type: "file",
            mediaType: normalizeMediaType(mediaType),
          });
        } else {
          await expect(
            resolveAttachmentsForModel(stage(file), OPENAI_AUDIO),
          ).rejects.toMatchObject({ messageKey: "file.mediaUnsupported" });
        }
      }
    });

    it("sends an x-wav row to openai-compatible as canonical wav", async () => {
      // A row persisted with the non-canonical spelling must not leak it to
      // the SDK, whose `input_audio` mapping rejects `audio/x-wav` outright.
      const file = makeMedia("audio-4", "voice.wav", "audio/x-wav");
      storageGet.mockResolvedValue(Buffer.from("pcm"));

      const routed = await resolveAttachmentsForModel(
        stage(file),
        OPENAI_AUDIO,
      );

      expect(routed[0]?.parts[0]).toMatchObject({
        type: "file",
        mediaType: "audio/wav",
        url: expect.stringContaining("data:audio/wav;base64,"),
      });
    });
  });
});
