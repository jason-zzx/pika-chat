import { lstatSync, readdirSync, rmSync, truncateSync } from "node:fs";
import { join } from "node:path";

export type StorageUsage = {
  localDataBytes: number;
  webCacheBytes: number;
  updaterCacheBytes: number;
  logsAndTempBytes: number;
};

export type StoragePaths = {
  userData: string;
  localRoot: string;
  localLogFile: string;
  updaterDir: string;
  downloadsDir: string;
};

const CHROMIUM_CACHE_DIRS = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "ShaderCache",
];

const UPDATER_DIR_NAME = "pika-chat-desktop-updater";

export function resolveUpdaterCacheDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string {
  const base =
    platform === "win32"
      ? env.LOCALAPPDATA || join(homeDir, "AppData", "Local")
      : platform === "darwin"
        ? join(homeDir, "Library", "Caches")
        : env.XDG_CACHE_HOME || join(homeDir, ".cache");
  return join(base, UPDATER_DIR_NAME);
}

function isRealDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function fileSize(path: string): number {
  try {
    const stat = lstatSync(path);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function dirSize(dir: string, excludeFiles?: Set<string>): number {
  if (!isRealDir(dir)) return 0;
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += dirSize(full, excludeFiles);
    } else if (entry.isFile() && !excludeFiles?.has(full)) {
      total += fileSize(full);
    }
  }
  return total;
}

export function listWebCacheDirs(userData: string): string[] {
  const roots = [userData];
  const partitionsDir = join(userData, "Partitions");
  if (isRealDir(partitionsDir)) {
    try {
      for (const entry of readdirSync(partitionsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) roots.push(join(partitionsDir, entry.name));
      }
    } catch {
      // ignore unreadable partition folder
    }
  }
  return roots.flatMap((root) => CHROMIUM_CACHE_DIRS.map((name) => join(root, name)));
}

export function removeDirContents(dir: string): void {
  if (!isRealDir(dir)) return;
  try {
    for (const entry of readdirSync(dir)) {
      try {
        rmSync(join(dir, entry), { recursive: true, force: true });
      } catch {
        // Active Chromium lock files on Windows cannot be unlinked while open; clearCache() handles live entries.
      }
    }
  } catch {
    // ignore unreadable dir
  }
}

export function measureStoragePaths(paths: StoragePaths): StorageUsage {
  const localDataBytes = dirSize(paths.localRoot, new Set([paths.localLogFile]));

  let webCacheBytes = 0;
  for (const dir of listWebCacheDirs(paths.userData)) {
    webCacheBytes += dirSize(dir);
  }

  const updaterCacheBytes = dirSize(paths.updaterDir);
  const desktopLog = join(paths.userData, "desktop.log");
  const logsAndTempBytes =
    fileSize(desktopLog) + fileSize(`${desktopLog}.1`) + fileSize(paths.localLogFile) + dirSize(paths.downloadsDir);

  return {
    localDataBytes,
    webCacheBytes,
    updaterCacheBytes,
    logsAndTempBytes,
  };
}

export function clearWebCacheDirs(userData: string): void {
  for (const dir of listWebCacheDirs(userData)) {
    removeDirContents(dir);
  }
}

export function clearLogsAndTempPaths(paths: Pick<StoragePaths, "userData" | "localLogFile" | "downloadsDir">): void {
  const desktopLog = join(paths.userData, "desktop.log");
  for (const file of [desktopLog, paths.localLogFile]) {
    try {
      if (lstatSync(file).isFile()) truncateSync(file, 0);
    } catch {
      // ignore missing or busy log file
    }
  }
  try {
    rmSync(`${desktopLog}.1`, { force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(paths.downloadsDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
