import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("falls back to the relay when the storage backend cannot sign", async () => {
    // Unreachable past the boot check (direct access requires S3), but the
    // route degrades to the relay instead of 500ing if they ever disagree.
    isS3DirectAccessEnabled.mockReturnValue(true);
    getFileStorage.mockReturnValue({ get: storageGet });

    const response = await GET(new Request("http://test/api/files/file-1"), context("file-1"));

    expect(response.status).toBe(200);
    expect(storageGet).toHaveBeenCalledWith("user-1/file-1");
  });
});
