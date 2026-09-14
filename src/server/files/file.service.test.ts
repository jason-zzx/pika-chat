import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/auth/actor";

import { fileIdsFromParts, fileUrl, storageKeyFor, uploadFile } from "./file.service";
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

describe("storageKeyFor", () => {
  it("appends the lowercased extension for console readability", () => {
    expect(storageKeyFor("u1", "f1", "pic.png")).toBe("u1/f1.png");
    expect(storageKeyFor("u1", "f1", "deck.PPTX")).toBe("u1/f1.pptx");
  });

  it("keeps only [a-z0-9] characters and caps the extension at 10 chars", () => {
    // The last dotted segment wins, matching `fileExtension()`.
    expect(storageKeyFor("u1", "f1", "archive.tar.gz")).toBe("u1/f1.gz");
    // Non-ASCII characters are filtered out entirely.
    expect(storageKeyFor("u1", "f1", "report.中文")).toBe("u1/f1");
    expect(storageKeyFor("u1", "f1", "my file.jpeg")).toBe("u1/f1.jpeg");
    expect(storageKeyFor("u1", "f1", `a.${"x".repeat(20)}`)).toBe(
      `u1/f1.${"x".repeat(10)}`,
    );
  });

  it("omits the dot when there is no usable extension", () => {
    expect(storageKeyFor("u1", "f1", "README")).toBe("u1/f1");
    // A leading dot is a dotfile, not an extension.
    expect(storageKeyFor("u1", "f1", ".gitignore")).toBe("u1/f1");
    // An all-punctuation extension filters down to nothing.
    expect(storageKeyFor("u1", "f1", "notes.---")).toBe("u1/f1");
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
});
