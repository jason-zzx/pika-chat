import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActor, listFilesForActor, uploadFile, sweepOrphanFiles } =
  vi.hoisted(() => ({
    requireActor: vi.fn(),
    listFilesForActor: vi.fn(),
    uploadFile: vi.fn(),
    sweepOrphanFiles: vi.fn(),
  }));

vi.mock("@/server/auth/actor", () => ({ requireActor }));
vi.mock("@/server/files/file.service", () => ({
  listFilesForActor,
  uploadFile,
  sweepOrphanFiles,
}));

import { FILE_LIST_DEFAULT_LIMIT } from "@/lib/files/constants";
import { AppError } from "@/server/errors";

import { GET } from "./route";

const ACTOR = { userId: "user-1", role: "user" };
const PAGE = { files: [], totalCount: 0, totalBytes: 0 };

function request(query = "") {
  return new Request(`http://test/api/files${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActor.mockResolvedValue(ACTOR);
  listFilesForActor.mockResolvedValue(PAGE);
});

describe("GET /api/files", () => {
  it("passes the parsed paging and category through", async () => {
    const response = await GET(
      request("?offset=10&limit=20&category=image"),
      undefined,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(PAGE);
    expect(listFilesForActor).toHaveBeenCalledWith(ACTOR, {
      offset: 10,
      limit: 20,
      category: "image",
    });
  });

  it("defaults offset and limit when omitted", async () => {
    await GET(request(), undefined);
    expect(listFilesForActor).toHaveBeenCalledWith(ACTOR, {
      offset: 0,
      limit: FILE_LIST_DEFAULT_LIMIT,
      category: undefined,
    });
  });

  it("falls back for malformed paging instead of failing the list", async () => {
    await GET(request("?limit=nope&offset=-5"), undefined);
    expect(listFilesForActor).toHaveBeenCalledWith(ACTOR, {
      offset: 0,
      limit: FILE_LIST_DEFAULT_LIMIT,
      category: undefined,
    });
  });

  it("rejects an unknown category with 400", async () => {
    const response = await GET(request("?category=bogus"), undefined);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(listFilesForActor).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    requireActor.mockRejectedValue(
      new AppError("UNAUTHENTICATED", 401, "auth.required"),
    );
    const response = await GET(request(), undefined);
    expect(response.status).toBe(401);
  });
});
