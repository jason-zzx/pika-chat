import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalDiskFileStorage } from "./storage";

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
