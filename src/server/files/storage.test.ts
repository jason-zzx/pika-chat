import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type FileStorage,
  LocalDiskFileStorage,
  S3FileStorage,
} from "./storage";

// `getEnv()` validates the whole environment, so the required variables have
// to exist before the backend-selection cases reload the module.
try {
  process.loadEnvFile(".env");
} catch {
  process.env.DATABASE_URL ??= "postgres://pika:pika@localhost:5432/pika_chat";
  process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
  process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
    "test-credential-encryption-secret-min-32";
}

const { send, s3ClientConfigs } = vi.hoisted(() => ({
  send: vi.fn<(command: unknown) => Promise<unknown>>(),
  s3ClientConfigs: new Array<unknown>(),
}));

// The command classes stay real (their `input` is what the assertions read);
// only the client is faked, so `send` is a spy and the constructor argument is
// captured for the backend-selection cases.
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class FakeS3Client {
    send = send;

    constructor(config: unknown) {
      s3ClientConfigs.push(config);
    }
  }
  return { ...actual, S3Client: FakeS3Client };
});

let root: string;
let storage: LocalDiskFileStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pika-files-"));
  storage = new LocalDiskFileStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalDiskFileStorage", () => {
  it("round-trips bytes through put/get", async () => {
    const data = Buffer.from("hello attachment");
    await storage.put("user-1/file-1", data);
    await expect(storage.get("user-1/file-1")).resolves.toEqual(data);
  });

  it("creates nested key directories on put", async () => {
    await storage.put("user-1/file-1", Buffer.from("x"));
    await expect(readdir(join(root, "user-1"))).resolves.toEqual(["file-1"]);
  });

  it("isolates keys from each other", async () => {
    await storage.put("user-1/file-1", Buffer.from("one"));
    await storage.put("user-2/file-1", Buffer.from("two"));
    await expect(storage.get("user-1/file-1")).resolves.toEqual(Buffer.from("one"));
    await expect(storage.get("user-2/file-1")).resolves.toEqual(Buffer.from("two"));
  });

  it("overwrites an existing key", async () => {
    await storage.put("user-1/file-1", Buffer.from("old"));
    await storage.put("user-1/file-1", Buffer.from("new"));
    await expect(storage.get("user-1/file-1")).resolves.toEqual(Buffer.from("new"));
  });

  it("delete removes the object and is idempotent", async () => {
    await storage.put("user-1/file-1", Buffer.from("x"));
    await storage.delete("user-1/file-1");
    await expect(storage.get("user-1/file-1")).rejects.toThrow();
    await expect(storage.delete("user-1/file-1")).resolves.toBeUndefined();
  });

  it("rejects a key that would escape the root", async () => {
    await expect(storage.put("../escape", Buffer.from("x"))).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(storage.delete("..")).rejects.toThrow(/Invalid storage key/);
  });
});

const S3_BUCKET = "pika-attachments";

/** Commands passed to the client, in order. */
function sentCommands(): unknown[] {
  return send.mock.calls.map(([command]) => command);
}

/** An SDK-shaped failure: S3 implementations disagree on the error name. */
function s3Failure(name: string, httpStatusCode: number): Error {
  const error = new Error(`${name}: ${httpStatusCode}`);
  error.name = name;
  Object.assign(error, { $metadata: { httpStatusCode } });
  return error;
}

function s3Body(bytes: number[]): unknown {
  return {
    Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(bytes)) },
  };
}

describe("S3FileStorage", () => {
  let s3: S3FileStorage;

  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
    s3ClientConfigs.length = 0;
    s3 = new S3FileStorage(new S3Client({ region: "us-east-1" }), S3_BUCKET);
  });

  it("put sends the bucket, the key, and the bytes as the body", async () => {
    const data = Buffer.from("hello attachment");
    await s3.put("user-1/file-1", data);
    const sent = sentCommands();
    expect(sent[0]).toBeInstanceOf(HeadBucketCommand);
    expect(sent[1]).toBeInstanceOf(PutObjectCommand);
    expect(sent[1]).toMatchObject({
      input: { Bucket: S3_BUCKET, Key: "user-1/file-1", Body: data },
    });
  });

  it("get returns the object body as a Buffer", async () => {
    send.mockResolvedValue(s3Body([104, 105]));
    await expect(s3.get("user-1/file-1")).resolves.toEqual(Buffer.from("hi"));
    expect(sentCommands()[1]).toBeInstanceOf(GetObjectCommand);
    expect(sentCommands()[1]).toMatchObject({
      input: { Bucket: S3_BUCKET, Key: "user-1/file-1" },
    });
  });

  it("get fails loudly when the object has no body", async () => {
    await expect(s3.get("user-1/file-1")).rejects.toThrow(/no body/);
  });

  it("delete removes the object and is idempotent", async () => {
    await s3.delete("user-1/file-1");
    await expect(s3.delete("user-1/file-1")).resolves.toBeUndefined();
    const sent = sentCommands();
    expect(sent).toHaveLength(3);
    expect(
      sent.filter((command) => command instanceof DeleteObjectCommand),
    ).toHaveLength(2);
  });

  it("rejects the same keys the disk backend rejects", async () => {
    const data = Buffer.from("x");
    await expect(s3.put("../escape", data)).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(s3.get("/etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(s3.delete("a/../../b")).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(s3.put("", data)).rejects.toThrow(/Invalid storage key/);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps an existing bucket", async () => {
    await s3.put("user-1/file-1", Buffer.from("x"));
    expect(sentCommands()).toHaveLength(2);
    expect(
      sentCommands().some((command) => command instanceof CreateBucketCommand),
    ).toBe(false);
  });

  it("creates the bucket when HeadBucket reports it missing by name", async () => {
    send.mockRejectedValueOnce(s3Failure("NotFound", 404));
    await s3.put("user-1/file-1", Buffer.from("x"));
    const sent = sentCommands();
    expect(sent[1]).toBeInstanceOf(CreateBucketCommand);
    expect(sent[1]).toMatchObject({ input: { Bucket: S3_BUCKET } });
    expect(sent[2]).toBeInstanceOf(PutObjectCommand);
  });

  it("creates the bucket when only the status says it is missing", async () => {
    send.mockRejectedValueOnce(s3Failure("SomethingElse", 404));
    await s3.delete("user-1/file-1");
    expect(sentCommands()[1]).toBeInstanceOf(CreateBucketCommand);
  });

  it("propagates a bucket error that is not a missing bucket", async () => {
    send.mockRejectedValueOnce(s3Failure("Forbidden", 403));
    await expect(s3.put("user-1/file-1", Buffer.from("x"))).rejects.toThrow(
      /Forbidden/,
    );
    expect(
      sentCommands().some((command) => command instanceof CreateBucketCommand),
    ).toBe(false);
    expect(
      sentCommands().some((command) => command instanceof PutObjectCommand),
    ).toBe(false);
  });

  it("retries the bootstrap after a transient failure", async () => {
    // A rejected bootstrap must not be cached: the first request can race the
    // endpoint coming up, and replaying that stale error forever would take
    // the whole process down with it.
    send.mockRejectedValueOnce(s3Failure("Forbidden", 403));
    await expect(s3.put("user-1/file-1", Buffer.from("x"))).rejects.toThrow(
      /Forbidden/,
    );
    await s3.put("user-1/file-1", Buffer.from("x"));
    expect(sentCommands().at(-1)).toBeInstanceOf(PutObjectCommand);
  });

  it("checks the bucket once per instance", async () => {
    await s3.put("user-1/file-1", Buffer.from("x"));
    await s3.delete("user-1/file-1");
    expect(
      sentCommands().filter((command) => command instanceof HeadBucketCommand),
    ).toHaveLength(1);
  });
});

const S3_ENV_KEYS = [
  "S3_BUCKET",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

describe("getFileStorage backend selection", () => {
  let saved: Partial<Record<(typeof S3_ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    saved = {};
    for (const key of S3_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    s3ClientConfigs.length = 0;
  });

  afterEach(() => {
    for (const key of S3_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // The env module and the storage singleton are both cached, so each case
  // reloads the module to see a fresh `process.env`.
  async function loadStorage(): Promise<{
    storageModule: typeof import("./storage");
    storage: FileStorage;
  }> {
    vi.resetModules();
    const storageModule = await import("./storage");
    return { storageModule, storage: storageModule.getFileStorage() };
  }

  it("stays on local disk when no bucket is configured", async () => {
    const { storageModule: module, storage: selected } = await loadStorage();
    expect(selected).toBeInstanceOf(module.LocalDiskFileStorage);
    expect(s3ClientConfigs).toHaveLength(0);
  });

  it("throws at construction when a bucket has no credentials", async () => {
    process.env.S3_BUCKET = S3_BUCKET;
    await expect(loadStorage()).rejects.toThrow(/S3_ACCESS_KEY_ID/);
  });

  it("throws at construction when only the access key is set", async () => {
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ACCESS_KEY_ID = "key-id";
    await expect(loadStorage()).rejects.toThrow(/S3_SECRET_ACCESS_KEY/);
  });

  it("uses S3 with a default region and path-style for a custom endpoint", async () => {
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ENDPOINT = "http://rustfs:9000";
    process.env.S3_ACCESS_KEY_ID = "key-id";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    const { storageModule: module, storage: selected } = await loadStorage();
    expect(selected).toBeInstanceOf(module.S3FileStorage);
    expect(s3ClientConfigs.at(-1)).toMatchObject({
      region: "us-east-1",
      endpoint: "http://rustfs:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "key-id", secretAccessKey: "secret" },
    });
  });

  it("honours an explicit region", async () => {
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ENDPOINT = "http://rustfs:9000";
    process.env.S3_REGION = "eu-west-1";
    process.env.S3_ACCESS_KEY_ID = "key-id";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    await loadStorage();
    expect(s3ClientConfigs.at(-1)).toMatchObject({
      region: "eu-west-1",
      forcePathStyle: true,
    });
  });

  it("leaves path-style off for the official endpoint", async () => {
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ACCESS_KEY_ID = "key-id";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    await loadStorage();
    expect(s3ClientConfigs.at(-1)).toMatchObject({ forcePathStyle: false });
  });
});
