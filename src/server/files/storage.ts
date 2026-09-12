import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { getEnv } from "@/server/env";

/**
 * Blob storage for chat attachments. Keys are opaque to callers; the current
 * layout is `<userId>/<fileId>`. A later S3 implementation swaps in behind the
 * same interface without touching the file service.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalDiskFileStorage implements FileStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  /**
   * Resolves a storage key to an absolute path, refusing to leave the root.
   * Keys are server-generated today, but a path-traversal guard here keeps a
   * future caller from turning a key into an arbitrary file read/write.
   */
  private resolveKey(key: string): string {
    const full = resolve(this.rootDir, key);
    if (full === this.rootDir || !full.startsWith(this.rootDir + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
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

export const DEFAULT_FILE_STORAGE_DIR = ".data/files";

let storage: FileStorage | undefined;

/** Process-wide storage singleton, mirroring `getDb()`. */
export function getFileStorage(): FileStorage {
  if (!storage) {
    storage = new LocalDiskFileStorage(
      getEnv().FILE_STORAGE_DIR ?? DEFAULT_FILE_STORAGE_DIR,
    );
  }
  return storage;
}
