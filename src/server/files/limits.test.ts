import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MAX_FILE_BYTES } from "@/lib/files/constants";

// `getEnv()` validates the whole environment, so the required variables have to
// exist before the cases reload the modules.
try {
  process.loadEnvFile(".env");
} catch {
  process.env.DATABASE_URL ??= "postgres://pika:pika@localhost:5432/pika_chat";
  process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
  process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
    "test-credential-encryption-secret-min-32";
}

const MANAGED = ["FILE_UPLOAD_MAX_MB", "S3_DIRECT_ACCESS"] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of MANAGED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// Both `env` and `limits` cache their result, so each case reloads the module
// to see a fresh `process.env`.
async function loadLimits(): Promise<typeof import("./limits")> {
  vi.resetModules();
  return import("./limits");
}

describe("maxFileBytes", () => {
  it("defaults to 20 MiB when FILE_UPLOAD_MAX_MB is unset", async () => {
    const { maxFileBytes } = await loadLimits();
    expect(maxFileBytes()).toBe(DEFAULT_MAX_FILE_BYTES);
  });

  it("reads the configured MiB value", async () => {
    process.env.FILE_UPLOAD_MAX_MB = "50";
    const { maxFileBytes } = await loadLimits();
    expect(maxFileBytes()).toBe(50 * 1024 * 1024);
  });
});

describe("isS3DirectAccessEnabled", () => {
  it("is off by default", async () => {
    const { isS3DirectAccessEnabled } = await loadLimits();
    expect(isS3DirectAccessEnabled()).toBe(false);
  });

  it("is on with the switch", async () => {
    process.env.S3_DIRECT_ACCESS = "1";
    const { isS3DirectAccessEnabled } = await loadLimits();
    expect(isS3DirectAccessEnabled()).toBe(true);
  });
});
