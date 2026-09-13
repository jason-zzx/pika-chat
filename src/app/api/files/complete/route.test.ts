import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActor, isS3DirectAccessEnabled, completeFile, sweepOrphanFiles } =
  vi.hoisted(() => ({
    requireActor: vi.fn(),
    isS3DirectAccessEnabled: vi.fn(),
    completeFile: vi.fn(),
    sweepOrphanFiles: vi.fn(),
  }));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/files/limits", () => ({
  isS3DirectAccessEnabled,
  maxFileBytes: vi.fn(),
}));
vi.mock("@/server/files/file.service", () => ({
  completeFile,
  sweepOrphanFiles,
}));

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/files/complete", {
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
  completeFile.mockResolvedValue({
    id: "file-1",
    url: "/api/files/file-1",
    filename: "notes.txt",
    mediaType: "text/plain",
    sizeBytes: 12,
    extraction: { status: "ok", truncated: false },
  });
});

describe("POST /api/files/complete", () => {
  it("returns the canonical upload response", async () => {
    const response = await POST(jsonRequest({ fileId: "file-1" }), undefined);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "file-1",
      url: "/api/files/file-1",
      extraction: { status: "ok", truncated: false },
    });
    expect(completeFile).toHaveBeenCalledWith("file-1", {
      userId: "user-1",
      role: "user",
    });
    // A direct deployment has no relay upload to piggyback the sweep on, so a
    // completed upload is what reclaims stale pending rows and drains the
    // provider-delete retry queue.
    expect(sweepOrphanFiles).toHaveBeenCalledWith({
      userId: "user-1",
      role: "user",
    });
  });

  it("answers 404 when direct upload is off", async () => {
    isS3DirectAccessEnabled.mockReturnValue(false);

    const response = await POST(jsonRequest({ fileId: "file-1" }), undefined);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", messageKey: "file.notFound" },
    });
    expect(completeFile).not.toHaveBeenCalled();
    expect(sweepOrphanFiles).not.toHaveBeenCalled();
  });

  it("rejects a body without a fileId as a validation failure", async () => {
    const response = await POST(jsonRequest({}), undefined);

    expect(response.status).toBe(400);
    expect(completeFile).not.toHaveBeenCalled();
    expect(sweepOrphanFiles).not.toHaveBeenCalled();
  });
});
