import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActor, maxFileBytes, isS3DirectAccessEnabled } = vi.hoisted(
  () => ({
    requireActor: vi.fn(),
    maxFileBytes: vi.fn(),
    isS3DirectAccessEnabled: vi.fn(),
  }),
);

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/files/limits", () => ({ maxFileBytes, isS3DirectAccessEnabled }));

import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue({ userId: "user-1", role: "user" });
  maxFileBytes.mockReturnValue(50 * 1024 * 1024);
  isS3DirectAccessEnabled.mockReturnValue(true);
});

describe("GET /api/files/limits", () => {
  it("returns the resolved upload limits", async () => {
    const response = await GET(
      new Request("http://test/api/files/limits"),
      undefined,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      maxFileBytes: 50 * 1024 * 1024,
      maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
      directUpload: true,
    });
  });
});
