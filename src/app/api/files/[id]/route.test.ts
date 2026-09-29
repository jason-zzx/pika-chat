import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const {
  requireActor,
  getFileForActor,
  deleteFile,
  isS3DirectAccessEnabled,
  getFileStorage,
} = vi.hoisted(() => ({
  requireActor: vi.fn(),
  getFileForActor: vi.fn(),
  deleteFile: vi.fn(),
  isS3DirectAccessEnabled: vi.fn(),
  getFileStorage: vi.fn(),
}));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/files/file.service", () => ({ getFileForActor, deleteFile }));
vi.mock("@/server/files/limits", () => ({
  isS3DirectAccessEnabled,
  maxFileBytes: vi.fn(),
}));
vi.mock("@/server/files/storage", () => ({ getFileStorage }));

import { AppError } from "@/server/errors";
import type { FileRecord } from "@/server/files/file.service";

import { GET } from "./route";

const ACTOR = { userId: "user-1", role: "user" };

function fileRow(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "file-1",
    userId: "user-1",
    filename: "a.png",
    mediaType: "image/png",
    sizeBytes: 3,
    storageKey: "user-1/file-1",
    ...overrides,
  } as FileRecord;
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const storageGet = vi.fn();
const createPresignedGet = vi.fn();

function pngBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 200,
      height: 100,
      channels: 3,
      background: { r: 200, g: 10, b: 10 },
    },
  })
    .png()
    .toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(ACTOR);
  getFileForActor.mockResolvedValue(fileRow());
  isS3DirectAccessEnabled.mockReturnValue(false);
  storageGet.mockResolvedValue(Buffer.from("png"));
  getFileStorage.mockReturnValue({ get: storageGet });
});

describe("GET /api/files/[id]", () => {
  it("relays the bytes when direct access is off", async () => {
    const response = await GET(new Request("http://test/api/files/file-1"), context("file-1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"a.png\"; filename*=UTF-8''a.png",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(Buffer.from("png"))).toBe(true);
    expect(createPresignedGet).not.toHaveBeenCalled();
  });

  it("redirects to a presigned GET when direct access is on", async () => {
    isS3DirectAccessEnabled.mockReturnValue(true);
    createPresignedGet.mockResolvedValue("https://s3.test/signed-get");
    getFileStorage.mockReturnValue({
      get: storageGet,
      createPresignedGet,
    });

    const response = await GET(new Request("http://test/api/files/file-1"), context("file-1"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://s3.test/signed-get");
    // The redirect cache must expire long before the 1h signature does.
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    // The signed URL carries the same overrides the relay headers would.
    expect(createPresignedGet).toHaveBeenCalledWith("user-1/file-1", {
      expiresSec: 3600,
      responseContentType: "image/png",
      responseContentDisposition:
        "inline; filename=\"a.png\"; filename*=UTF-8''a.png",
    });
    // The bytes never pass through the app.
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("signs an attachment disposition for a non-inline type", async () => {
    isS3DirectAccessEnabled.mockReturnValue(true);
    getFileForActor.mockResolvedValue(
      fileRow({ filename: "notes.txt", mediaType: "text/plain" }),
    );
    createPresignedGet.mockResolvedValue("https://s3.test/signed-get");
    getFileStorage.mockReturnValue({
      get: storageGet,
      createPresignedGet,
    });

    const response = await GET(new Request("http://test/api/files/file-1"), context("file-1"));

    expect(response.status).toBe(302);
    expect(createPresignedGet).toHaveBeenCalledWith("user-1/file-1", {
      expiresSec: 3600,
      responseContentType: "text/plain",
      responseContentDisposition:
        "attachment; filename=\"notes.txt\"; filename*=UTF-8''notes.txt",
    });
  });

  it("answers 404 for a foreign id without signing anything", async () => {
    isS3DirectAccessEnabled.mockReturnValue(true);
    getFileForActor.mockRejectedValue(
      new AppError("NOT_FOUND", 404, "file.notFound"),
    );
    getFileStorage.mockReturnValue({
      get: storageGet,
      createPresignedGet,
    });

    const response = await GET(new Request("http://test/api/files/file-2"), context("file-2"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", messageKey: "file.notFound" },
    });
    expect(createPresignedGet).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("serves a downscaled square webp for ?thumb=1 on an image", async () => {
    storageGet.mockResolvedValue(await pngBytes());

    const response = await GET(
      new Request("http://test/api/files/file-1?thumb=1"),
      context("file-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const thumb = await sharp(
      Buffer.from(await response.arrayBuffer()),
    ).metadata();
    expect(thumb.format).toBe("webp");
    expect(thumb.width).toBe(64);
    expect(thumb.height).toBe(64);
  });

  it("relays ?thumb=1 through the app even when direct access is on", async () => {
    isS3DirectAccessEnabled.mockReturnValue(true);
    createPresignedGet.mockResolvedValue("https://s3.test/signed-get");
    getFileStorage.mockReturnValue({ get: storageGet, createPresignedGet });
    storageGet.mockResolvedValue(await pngBytes());

    const response = await GET(
      new Request("http://test/api/files/file-1?thumb=1"),
      context("file-1"),
    );

    // A presigned redirect would hand back the full original, so thumbnails
    // never redirect.
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(createPresignedGet).not.toHaveBeenCalled();
  });

  it("falls back to the original bytes when the image cannot be resized", async () => {
    // The default storageGet payload ("png") is not a real image.
    const response = await GET(
      new Request("http://test/api/files/file-1?thumb=1"),
      context("file-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(Buffer.from("png"))).toBe(true);
  });

  it("ignores ?thumb=1 for non-image files", async () => {
    getFileForActor.mockResolvedValue(
      fileRow({ filename: "notes.txt", mediaType: "text/plain" }),
    );

    const response = await GET(
      new Request("http://test/api/files/file-1?thumb=1"),
      context("file-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
  });
});
