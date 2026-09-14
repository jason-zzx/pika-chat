import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost as createS3PresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getEnv } from "@/server/env";

/** A presigned POST policy a browser can upload one object with. */
export type PresignedPost = {
  url: string;
  fields: Record<string, string>;
};

/**
 * Blob storage for chat attachments. Keys are opaque to callers; new rows
 * use `<userId>/<fileId>.<ext>` so objects are recognizable in a storage
 * console, older rows keep their extension-less keys. Implementations swap
 * freely behind this interface without touching the file service.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /**
   * Presigned POST policy for a direct browser→storage upload. Only object
   * storage implements it — local disk has no equivalent, which is why
   * `S3_DIRECT_ACCESS` requires S3 at boot.
   */
  createPresignedPost?(
    key: string,
    options: { maxBytes: number; expiresSec: number },
  ): Promise<PresignedPost>;
  /**
   * Presigned GET URL a browser can follow straight to the object, with the
   * response's Content-Type and Content-Disposition overridden so the
   * redirect keeps the relay path's inline/download semantics. S3-only, for
   * the same reason as {@link FileStorage.createPresignedPost}.
   */
  createPresignedGet?(
    key: string,
    options: {
      expiresSec: number;
      responseContentType: string;
      responseContentDisposition: string;
    },
  ): Promise<string>;
}

/**
 * Refuses keys that could address something other than a single object under
 * the storage root: empty, absolute, blank, or containing a `.`/`..` segment.
 * Keys are server-generated today, but the guard is shared by every backend so
 * the contract does not change when the backend does.
 */
export function assertValidStorageKey(key: string): void {
  if (key.length === 0) {
    throw new Error("Invalid storage key: key is empty");
  }
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new Error(`Invalid storage key: absolute path (${key})`);
  }
  if (key.includes("\0")) {
    throw new Error("Invalid storage key: key contains a null byte");
  }
  const traversal = key
    .split(/[/\\]/)
    .some((segment) => segment === "" || segment === "." || segment === "..");
  if (traversal) {
    throw new Error(`Invalid storage key: traversal segment (${key})`);
  }
}

export class LocalDiskFileStorage implements FileStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  private resolveKey(key: string): string {
    assertValidStorageKey(key);
    return resolve(this.rootDir, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }
}

/**
 * S3-compatible object storage (AWS S3, MinIO, RustFS, R2). Keys map one to
 * one onto object keys. Reads and writes are whole-Buffer, matching the local
 * backend: attachments are capped at 20 MB, so streaming would buy nothing.
 */
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady: Promise<void> | undefined;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertValidStorageKey(key);
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertValidStorageKey(key);
    await this.ensureBucket();
    const output = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = output.Body;
    if (!body) {
      throw new Error(`S3 object has no body: ${key}`);
    }
    return Buffer.from(await body.transformToByteArray());
  }

  // A missing object is already a no-op for S3, so this matches the disk
  // implementation's `force: true`.
  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await this.ensureBucket();
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Signs a POST policy whose `content-length-range` is the first of two size
   * gates: S3 refuses a body outside 1..maxBytes, and `completeFile` re-checks
   * the object's real byte count because a client-reported size is never
   * evidence.
   */
  async createPresignedPost(
    key: string,
    options: { maxBytes: number; expiresSec: number },
  ): Promise<PresignedPost> {
    assertValidStorageKey(key);
    await this.ensureBucket();
    return createS3PresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [["content-length-range", 1, options.maxBytes]],
      Expires: options.expiresSec,
    });
  }

  /**
   * Signs a GET whose response header overrides make the object answer with
   * the same Content-Type and inline/attachment disposition the relay path
   * would have used — the 302 the file route hands out is otherwise a plain
   * S3 response. The bucket is resolved first so a first-ever download does
   * not sign a URL for a bucket that does not exist yet.
   */
  async createPresignedGet(
    key: string,
    options: {
      expiresSec: number;
      responseContentType: string;
      responseContentDisposition: string;
    },
  ): Promise<string> {
    assertValidStorageKey(key);
    await this.ensureBucket();
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.responseContentType,
        ResponseContentDisposition: options.responseContentDisposition,
      }),
      { expiresIn: options.expiresSec },
    );
  }

  /**
   * Ensures the bucket exists at most once per instance: HeadBucket succeeds
   * for an existing bucket, a 404 creates it, and anything else (unreachable
   * endpoint, bad credentials) propagates as-is so the operator sees the real
   * cause. Operators therefore never create the bucket by hand.
   */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= this.createBucketIfMissing().catch(
      (error: unknown) => {
        // Only a *successful* bootstrap is cached. A rejected one is dropped so
        // the next call retries: otherwise a single transient failure at
        // startup (endpoint not up yet, blip in the network) would be replayed
        // as a stale error for the whole lifetime of the process.
        this.bucketReady = undefined;
        throw error;
      },
    );
    return this.bucketReady;
  }

  private async createBucketIfMissing(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (error) {
      if (!isBucketMissing(error)) {
        throw error;
      }
    }
    // No explicit `CreateBucketConfiguration`: the SDK's
    // location-constraint middleware fills in `LocationConstraint` from the
    // client region when it is not `us-east-1`, so both AWS and the
    // S3-compatible endpoints get what they expect.
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
  }
}

/**
 * HeadBucket answers 404 for a missing bucket. The error shape varies across
 * S3 implementations, so the name and the HTTP status are both consulted.
 */
function isBucketMissing(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "NotFound" || error.name === "NoSuchBucket") {
    return true;
  }
  const metadata = "$metadata" in error ? error.$metadata : undefined;
  if (typeof metadata !== "object" || metadata === null) {
    return false;
  }
  const status =
    "httpStatusCode" in metadata ? metadata.httpStatusCode : undefined;
  return status === 404;
}

export const DEFAULT_FILE_STORAGE_DIR = ".data/files";

/** S3-compatible endpoints conventionally accept any region string. */
const DEFAULT_S3_REGION = "us-east-1";

let storage: FileStorage | undefined;

/** Process-wide storage singleton, mirroring `getDb()`. */
export function getFileStorage(): FileStorage {
  storage ??= createFileStorage();
  return storage;
}

function createFileStorage(): FileStorage {
  const env = getEnv();
  const bucket = env.S3_BUCKET;
  if (!bucket) {
    return new LocalDiskFileStorage(
      env.FILE_STORAGE_DIR ?? DEFAULT_FILE_STORAGE_DIR,
    );
  }
  // Fail here rather than on the first upload: a half-configured S3 backend
  // would otherwise look healthy until someone attaches a file.
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "S3_BUCKET is set but S3 credentials are missing: set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
    );
  }
  return new S3FileStorage(
    new S3Client({
      region: env.S3_REGION ?? DEFAULT_S3_REGION,
      endpoint: env.S3_ENDPOINT,
      // Path-style is required by MinIO/RustFS on a container network with no
      // wildcard DNS, so it turns on with a custom endpoint; the official AWS
      // endpoint keeps the virtual-hosted default. Credentials come straight
      // from env and are never logged.
      forcePathStyle: env.S3_ENDPOINT !== undefined,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
    bucket,
  );
}
