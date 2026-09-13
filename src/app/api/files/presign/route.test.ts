import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActor, isS3DirectAccessEnabled, presignFile, sweepOrphanFiles } =
  vi.hoisted(() => ({
    requireActor: vi.fn(),
    isS3DirectAccessEnabled: vi.fn(),
    presignFile: vi.fn(),
    sweepOrphanFiles: vi.fn(),
  }));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/files/limits", () => ({
  isS3DirectAccessEnabled,
  maxFileBytes: vi.fn(),
}));
vi.mock("@/server/files/file.service", () => ({
  presignFile,
  sweepOrphanFiles,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/files/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue({ userId: "user-1", role: "user" });
  isS3DirectAccessEnabled.mockReturnValue(true);
  sweepOrphanFiles.mockResolvedValue(undefined);
  presignFile.mockResolvedValue({
    fileId: "file-1",
    post: { url: "https://s3.test/bucket", fields: { key: "k" } },
  });
});

describe("POST /api/files/presign", () => {
  it("returns the pending row id and the signed policy", async () => {
    const response = await POST(
      jsonRequest({ filename: "notes.txt", mediaType: "text/plain" }),
      undefined,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      fileId: "file-1",
      post: { url: "https://s3.test/bucket", fields: { key: "k" } },
    });
    expect(presignFile).toHaveBeenCalledWith(
      { filename: "notes.txt", mediaType: "text/plain" },
      { userId: "user-1", role: "user" },
    );
    // Presign triggers the sweep too, so a user who abandons an upload still
    // has their previous pending rows (and the retry queue) reclaimed. The
    // sweep's 24h TTL protects the row just inserted.
    expect(sweepOrphanFiles).toHaveBeenCalledWith({
      userId: "user-1",
      role: "user",
    });
  });

  it("answers 404 when direct upload is off", async () => {
    isS3DirectAccessEnabled.mockReturnValue(false);

    const response = await POST(
      jsonRequest({ filename: "notes.txt", mediaType: "text/plain" }),
      undefined,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", messageKey: "file.notFound" },
    });
    expect(presignFile).not.toHaveBeenCalled();
    expect(sweepOrphanFiles).not.toHaveBeenCalled();
  });

  it("rejects a body without a filename as a validation failure", async () => {
    const response = await POST(jsonRequest({ mediaType: "text/plain" }), undefined);

    expect(response.status).toBe(400);
    expect(presignFile).not.toHaveBeenCalled();
    expect(sweepOrphanFiles).not.toHaveBeenCalled();
  });
});
