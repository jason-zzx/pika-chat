import { beforeAll, describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

try {
  process.loadEnvFile(".env");
} catch {
  process.env.DATABASE_URL ??= "postgres://pika:pika@localhost:5432/pika_chat";
  process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
  process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
    "test-credential-encryption-secret-min-32";
}

describe("credential envelope", () => {
  beforeAll(async () => {
    const { getEnv } = await import("@/server/env");
    getEnv();
  });

  it("round-trips plaintext", async () => {
    const { decryptSecret, encryptSecret } = await import("./crypto");
    const plaintext = "sk-test-key-value";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("produces a different envelope for the same plaintext", async () => {
    const { encryptSecret } = await import("./crypto");
    const plaintext = "sk-test-key-value";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("rejects a tampered auth tag", async () => {
    const { decryptSecret, encryptSecret } = await import("./crypto");
    const envelope = encryptSecret("sk-test-key-value");
    const parts = envelope.split(".");
    const tag = parts[3];
    expect(tag).toBeDefined();
    if (!tag) {
      throw new Error("expected auth tag segment");
    }
    const flipped = Buffer.from(tag, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    parts[3] = flipped.toString("base64url");

    try {
      decryptSecret(parts.join("."));
      throw new Error("expected decrypt to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "INTERNAL", status: 500 });
    }
  });

  it("rejects an unknown envelope version", async () => {
    const { decryptSecret, encryptSecret } = await import("./crypto");
    const envelope = encryptSecret("sk-test-key-value").replace(/^v1\./, "v2.");
    try {
      decryptSecret(envelope);
      throw new Error("expected decrypt to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "INTERNAL", status: 500 });
    }
  });
});
