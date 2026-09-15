import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `getEnv()` validates the whole environment, so the required variables have to
// exist before the cases reload the module.
try {
  process.loadEnvFile(".env");
} catch {
  process.env.DATABASE_URL ??= "postgres://pika:pika@localhost:5432/pika_chat";
  process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
  process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
    "test-credential-encryption-secret-min-32";
}

const MANAGED = [
  "FILE_UPLOAD_MAX_MB",
  "S3_DIRECT_ACCESS",
  "S3_BUCKET",
  "NEXT_RUNTIME",
  "APP_URL",
  "APP_TRUSTED_ORIGINS",
] as const;

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

// `getEnv()` caches, so each case reloads the module to see a fresh
// `process.env`.
async function loadEnvModule(): Promise<typeof import("@/server/env")> {
  vi.resetModules();
  return import("@/server/env");
}

describe("FILE_UPLOAD_MAX_MB", () => {
  it("is undefined when unset", async () => {
    const { getEnv } = await loadEnvModule();
    expect(getEnv().FILE_UPLOAD_MAX_MB).toBeUndefined();
  });

  it.each(["1", "50", "100"])("accepts %s", async (value) => {
    process.env.FILE_UPLOAD_MAX_MB = value;
    const { getEnv } = await loadEnvModule();
    expect(getEnv().FILE_UPLOAD_MAX_MB).toBe(Number(value));
  });

  it.each(["0", "101", "1.5", "abc", ""])("rejects %j", async (value) => {
    process.env.FILE_UPLOAD_MAX_MB = value;
    const { getEnv } = await loadEnvModule();
    expect(() => getEnv()).toThrow(/FILE_UPLOAD_MAX_MB/);
  });
});

describe("S3_DIRECT_ACCESS", () => {
  it("is undefined when unset", async () => {
    const { getEnv } = await loadEnvModule();
    expect(getEnv().S3_DIRECT_ACCESS).toBeUndefined();
  });

  it.each(["1", "true"])("accepts %s", async (value) => {
    process.env.S3_DIRECT_ACCESS = value;
    const { getEnv } = await loadEnvModule();
    expect(getEnv().S3_DIRECT_ACCESS).toBe(value);
  });

  it.each(["0", "false", "yes", ""])("rejects %j", async (value) => {
    process.env.S3_DIRECT_ACCESS = value;
    const { getEnv } = await loadEnvModule();
    expect(() => getEnv()).toThrow(/S3_DIRECT_ACCESS/);
  });
});

describe("register boot guard", () => {
  it("refuses direct access without an S3 bucket", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.S3_DIRECT_ACCESS = "1";
    vi.resetModules();
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/S3_DIRECT_ACCESS/);
  });

  it("boots when direct access is off", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    vi.resetModules();
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("skips validation outside the Node.js runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    process.env.S3_DIRECT_ACCESS = "1";
    vi.resetModules();
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });
});

describe("resolveDatabaseUrl", () => {
  it("prioritizes DATABASE_URL if set", async () => {
    const { resolveDatabaseUrl } = await loadEnvModule();
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: "postgres://direct:secret@custom:5432/mydb",
        POSTGRES_HOST: "other",
      }),
    ).toBe("postgres://direct:secret@custom:5432/mydb");
  });

  it("assembles connection URI from discrete variables with encoding", async () => {
    const { resolveDatabaseUrl } = await loadEnvModule();
    expect(
      resolveDatabaseUrl({
        POSTGRES_USER: "my/user",
        POSTGRES_PASSWORD: "p@ss:word#123",
        POSTGRES_HOST: "pg.internal",
        POSTGRES_PORT: "5433",
        POSTGRES_DB: "custom_db",
      }),
    ).toBe("postgres://my%2Fuser:p%40ss%3Aword%23123@pg.internal:5433/custom_db");
  });

  it("uses sensible defaults for omitted discrete variables", async () => {
    const { resolveDatabaseUrl } = await loadEnvModule();
    expect(
      resolveDatabaseUrl({
        POSTGRES_HOST: "192.168.1.50",
      }),
    ).toBe("postgres://postgres@192.168.1.50:5432/pika_chat");
  });

  it("returns undefined when no database variables exist", async () => {
    const { resolveDatabaseUrl } = await loadEnvModule();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

describe("resolveTrustedOrigins", () => {
  it("parses and trims origins from APP_TRUSTED_ORIGINS", async () => {
    const { resolveTrustedOrigins } = await loadEnvModule();
    expect(
      resolveTrustedOrigins({
        APP_TRUSTED_ORIGINS:
          "http://localhost:3000, http://192.168.1.100:3000 , https://chat.example.com",
      }),
    ).toEqual([
      "http://localhost:3000",
      "http://192.168.1.100:3000",
      "https://chat.example.com",
    ]);
  });

  it("returns an empty array when unset or empty", async () => {
    const { resolveTrustedOrigins } = await loadEnvModule();
    expect(resolveTrustedOrigins({})).toEqual([]);
    expect(
      resolveTrustedOrigins({
        APP_TRUSTED_ORIGINS: " , , ",
      }),
    ).toEqual([]);
  });
});

describe("APP_URL in getEnv", () => {
  it("is undefined when unset", async () => {
    const { getEnv } = await loadEnvModule();
    expect(getEnv().APP_URL).toBeUndefined();
  });

  it("accepts valid URL for APP_URL", async () => {
    process.env.APP_URL = "https://chat.example.com";
    const { getEnv } = await loadEnvModule();
    expect(getEnv().APP_URL).toBe("https://chat.example.com");
  });

  it("treats empty string as undefined", async () => {
    process.env.APP_URL = "";
    process.env.APP_TRUSTED_ORIGINS = "";
    const { getEnv } = await loadEnvModule();
    expect(getEnv().APP_URL).toBeUndefined();
    expect(getEnv().APP_TRUSTED_ORIGINS).toBeUndefined();
  });

  it("rejects invalid URL strings", async () => {
    process.env.APP_URL = "not-a-valid-url";
    const { getEnv } = await loadEnvModule();
    expect(() => getEnv()).toThrow(/APP_URL/);
  });
});
