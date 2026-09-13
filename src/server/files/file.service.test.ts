import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";

import { fileIdsFromParts, fileUrl, presignFile, uploadFile } from "./file.service";
import { maxFileBytes } from "./limits";

// `maxFileBytes()` reads the environment through `getEnv()`, which validates
// the whole schema, so the required variables have to exist before the upload
// cases run.
try {
  process.loadEnvFile(".env");
} catch {
  process.env.DATABASE_URL ??= "postgres://pika:pika@localhost:5432/pika_chat";
  process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
  process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
    "test-credential-encryption-secret-min-32";
}

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
          data: Buffer.alloc(maxFileBytes() + 1),
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.tooLarge",
    });
  });

  it("honours the configured FILE_UPLOAD_MAX_MB", async () => {
    process.env.FILE_UPLOAD_MAX_MB = "1";
    try {
      vi.resetModules();
      const { uploadFile: freshUpload } = await import("./file.service");
      await expect(
        freshUpload(
          {
            filename: "big.txt",
            mediaType: "text/plain",
            data: Buffer.alloc(1024 * 1024 + 1),
          },
          actor,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        messageKey: "file.tooLarge",
        params: { limit: "1.0 MB" },
      });
    } finally {
      delete process.env.FILE_UPLOAD_MAX_MB;
    }
  });
});

describe("presignFile validation", () => {
  it("rejects a type outside the whitelist before touching storage", async () => {
    await expect(
      presignFile(
        { filename: "archive.zip", mediaType: "application/zip" },
        actor,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      messageKey: "file.unsupportedType",
    });
  });
});
