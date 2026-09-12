import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "@/lib/files/constants";
import type { Actor } from "@/server/auth/actor";

import { fileIdsFromParts, fileUrl, uploadFile } from "./file.service";

const actor: Actor = { userId: "user-1", role: "user" };

describe("fileUrl", () => {
  it("builds the canonical attachment path", () => {
    expect(fileUrl("abc")).toBe("/api/files/abc");
  });
});

describe("fileIdsFromParts", () => {
  it("collects, dedupes, and filters file parts", () => {
    expect(
      fileIdsFromParts([
        { type: "file", url: "/api/files/a" },
        { type: "text", text: "hi" },
        { type: "file", url: "/api/files/a" },
        { type: "file", url: "/api/files/b", mediaType: "image/png" },
        { type: "file", url: "https://evil.example/c" },
        { type: "file" },
        null,
        "nope",
      ]),
    ).toEqual(["a", "b"]);
  });

  it("returns [] for a non-array payload", () => {
    expect(fileIdsFromParts(null)).toEqual([]);
    expect(fileIdsFromParts({})).toEqual([]);
  });
});

describe("uploadFile validation", () => {
  it("rejects a type outside the whitelist before touching storage", async () => {
    await expect(
      uploadFile(
        {
          filename: "archive.zip",
          mediaType: "application/zip",
          data: Buffer.from("x"),
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.unsupportedType",
    });
  });

  it("rejects a file over the size limit", async () => {
    await expect(
      uploadFile(
        {
          filename: "big.txt",
          mediaType: "text/plain",
          data: Buffer.alloc(MAX_FILE_BYTES + 1),
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.tooLarge",
    });
  });
});
