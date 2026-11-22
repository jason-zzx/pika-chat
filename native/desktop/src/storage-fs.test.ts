import assert from "node:assert/strict";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  clearLogsAndTempPaths,
  clearWebCacheDirs,
  measureStoragePaths,
  removeDirContents,
  resolveUpdaterCacheDir,
  type StoragePaths,
} from "./storage-fs";

const tempDirs: string[] = [];

function makeSandbox(): { root: string; external: string; paths: StoragePaths } {
  const root = mkdtempSync(join(tmpdir(), "pika-storage-test-"));
  const external = mkdtempSync(join(tmpdir(), "pika-storage-ext-"));
  tempDirs.push(root, external);

  const userData = join(root, "userData");
  const localRoot = join(userData, "local");
  const paths: StoragePaths = {
    userData,
    localRoot,
    localLogFile: join(localRoot, "server.log"),
    updaterDir: join(root, "updater"),
    downloadsDir: join(root, "downloads"),
  };
  return { root, external, paths };
}

function writeBytes(filePath: string, size: number, fill = "a"): string {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, fill.repeat(size));
  return filePath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveUpdaterCacheDir", () => {
  it("resolves updater directory per platform with env overrides", () => {
    assert.equal(
      resolveUpdaterCacheDir("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a"),
      join("C:\\Users\\a\\AppData\\Local", "pika-chat-desktop-updater"),
    );
    assert.equal(
      resolveUpdaterCacheDir("win32", {}, "/home/a"),
      join("/home/a", "AppData", "Local", "pika-chat-desktop-updater"),
    );
    assert.equal(
      resolveUpdaterCacheDir("darwin", {}, "/Users/a"),
      join("/Users/a", "Library", "Caches", "pika-chat-desktop-updater"),
    );
    assert.equal(
      resolveUpdaterCacheDir("linux", { XDG_CACHE_HOME: "/tmp/cache" }, "/home/a"),
      join("/tmp/cache", "pika-chat-desktop-updater"),
    );
    assert.equal(
      resolveUpdaterCacheDir("linux", {}, "/home/a"),
      join("/home/a", ".cache", "pika-chat-desktop-updater"),
    );
  });
});

describe("measureStoragePaths", () => {
  it("returns zeros when directories do not exist", () => {
    const { paths } = makeSandbox();
    assert.deepEqual(measureStoragePaths(paths), {
      localDataBytes: 0,
      webCacheBytes: 0,
      updaterCacheBytes: 0,
      logsAndTempBytes: 0,
    });
  });

  it("buckets sizes per category without overlapping local/server.log or non-cache data", () => {
    const { paths } = makeSandbox();

    writeBytes(join(paths.localRoot, "pika-chat.db"), 120);
    writeBytes(join(paths.localRoot, "files", "upload.bin"), 80);
    writeBytes(paths.localLogFile, 45);

    writeBytes(join(paths.userData, "Cache", "entry"), 200);
    writeBytes(join(paths.userData, "Code Cache", "js", "mod"), 150);
    writeBytes(join(paths.userData, "Partitions", "srv-1", "GPUCache", "shader"), 50);
    // Non-cache files must not inflate webCacheBytes.
    writeBytes(join(paths.userData, "Cookies"), 999);
    writeBytes(join(paths.userData, "Partitions", "srv-1", "Local Storage", "leveldb"), 777);

    writeBytes(join(paths.updaterDir, "pending", "setup.exe"), 500);

    writeBytes(join(paths.userData, "desktop.log"), 30);
    writeBytes(join(paths.userData, "desktop.log.1"), 25);
    writeBytes(join(paths.downloadsDir, "update-tmp", "part.bin"), 60);

    assert.deepEqual(measureStoragePaths(paths), {
      localDataBytes: 200,
      webCacheBytes: 400,
      updaterCacheBytes: 500,
      logsAndTempBytes: 160,
    });
  });

  it("ignores symlinks when measuring files and cache directories", () => {
    const { external, paths } = makeSandbox();
    const secretFile = writeBytes(join(external, "secret.bin"), 1000, "z");
    const secretDir = join(external, "dir");
    writeBytes(join(secretDir, "payload.bin"), 2000, "z");

    mkdirSync(paths.localRoot, { recursive: true });
    writeBytes(join(paths.localRoot, "pika-chat.db"), 10);
    symlinkSync(secretFile, join(paths.localRoot, "link.bin"));

    mkdirSync(join(paths.userData, "Partitions"), { recursive: true });
    symlinkSync(secretDir, join(paths.userData, "Cache"));
    symlinkSync(secretDir, join(paths.userData, "Partitions", "sym-part"));

    symlinkSync(secretDir, paths.updaterDir);
    symlinkSync(secretFile, join(paths.userData, "desktop.log"));

    assert.deepEqual(measureStoragePaths(paths), {
      localDataBytes: 10,
      webCacheBytes: 0,
      updaterCacheBytes: 0,
      logsAndTempBytes: 0,
    });
  });
});

describe("storage cleanup helpers", () => {
  it("clears webCache contents while keeping non-cache files and symlink targets intact", () => {
    const { external, paths } = makeSandbox();

    writeBytes(join(paths.userData, "Cache", "entry"), 100);
    writeBytes(join(paths.userData, "Partitions", "srv-1", "Code Cache", "mod"), 200);
    const keepCookies = writeBytes(join(paths.userData, "Cookies"), 42);
    const keepStorage = writeBytes(join(paths.userData, "Partitions", "srv-1", "Local Storage", "db"), 64);

    // Symlinked GPUCache must never have its external target wiped.
    const symlinkTarget = join(external, "cache-target");
    writeBytes(join(symlinkTarget, "inside.bin"), 128);
    symlinkSync(symlinkTarget, join(paths.userData, "GPUCache"));

    clearWebCacheDirs(paths.userData);

    assert.equal(measureStoragePaths(paths).webCacheBytes, 0);
    assert.equal(readFileSync(keepCookies).length, 42);
    assert.equal(readFileSync(keepStorage).length, 64);
    assert.equal(readFileSync(join(symlinkTarget, "inside.bin")).length, 128);
  });

  it("clears updater cache contents without traversing symlinks", () => {
    const { external, paths } = makeSandbox();
    const target = join(external, "ext-updater");
    const targetFile = writeBytes(join(target, "keep.exe"), 300);

    writeBytes(join(paths.updaterDir, "pending", "pika.exe"), 400);
    removeDirContents(paths.updaterDir);
    assert.equal(measureStoragePaths(paths).updaterCacheBytes, 0);

    rmSync(paths.updaterDir, { recursive: true, force: true });
    symlinkSync(target, paths.updaterDir);
    removeDirContents(paths.updaterDir);
    assert.equal(readFileSync(targetFile).length, 300);
  });

  it("truncates logs and removes temp downloads without touching local data or symlink targets", () => {
    const { external, paths } = makeSandbox();
    const externalLog = writeBytes(join(external, "real.log"), 90, "L");

    const dbFile = writeBytes(join(paths.localRoot, "pika-chat.db"), 120);
    const desktopLog = writeBytes(join(paths.userData, "desktop.log"), 75);
    writeBytes(join(paths.userData, "desktop.log.1"), 55);
    writeBytes(join(paths.downloadsDir, "pkg.zip"), 333);
    symlinkSync(externalLog, paths.localLogFile);

    clearLogsAndTempPaths(paths);

    assert.equal(readFileSync(desktopLog).length, 0);
    assert.equal(readFileSync(dbFile).length, 120);
    assert.equal(readFileSync(externalLog).length, 90);
    const usage = measureStoragePaths(paths);
    assert.equal(usage.localDataBytes, 120);
    assert.equal(usage.logsAndTempBytes, 0);
  });

  it("keeps append-mode log writes free of sparse gaps after truncation", async () => {
    const { paths } = makeSandbox();
    mkdirSync(paths.localRoot, { recursive: true });
    writeFileSync(paths.localLogFile, "");
    const stream = createWriteStream(paths.localLogFile, { flags: "a" });
    try {
      await once(stream, "open");
      await new Promise<void>((resolve, reject) =>
        stream.write("A".repeat(4096), (err) => (err ? reject(err) : resolve())),
      );
      clearLogsAndTempPaths(paths);
      assert.equal(readFileSync(paths.localLogFile).length, 0);
      stream.write("next\n");
      await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));
      assert.equal(readFileSync(paths.localLogFile, "utf8"), "next\n");
    } finally {
      if (!stream.closed) stream.destroy();
    }
  });
});
