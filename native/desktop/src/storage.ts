import { app, session } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { localPaths } from "./local-server";
import {
  clearLogsAndTempPaths,
  clearWebCacheDirs,
  measureStoragePaths,
  removeDirContents,
  resolveUpdaterCacheDir,
  type StoragePaths,
  type StorageUsage,
} from "./storage-fs";

export type StorageCategory = "webCache" | "updaterCache" | "logsAndTemp";
export type { StorageUsage };

export function desktopLogPath(): string {
  return join(app.getPath("userData"), "desktop.log");
}

function storagePaths(downloadsDir: string): StoragePaths {
  return {
    userData: app.getPath("userData"),
    localRoot: localPaths().root,
    localLogFile: localPaths().logFile,
    updaterDir: resolveUpdaterCacheDir(process.platform, process.env, homedir()),
    downloadsDir,
  };
}

export function measureStorageUsage(downloadsDir: string): StorageUsage {
  return measureStoragePaths(storagePaths(downloadsDir));
}

export async function clearStorageCategory(
  category: StorageCategory,
  downloadsDir: string,
  knownPartitions: string[],
): Promise<StorageUsage> {
  const paths = storagePaths(downloadsDir);

  if (category === "webCache") {
    await session.defaultSession.clearCache().catch(() => {});
    for (const partition of new Set(knownPartitions)) {
      await session.fromPartition(partition).clearCache().catch(() => {});
    }
    clearWebCacheDirs(paths.userData);
    return measureStoragePaths(paths);
  }

  if (category === "updaterCache") {
    removeDirContents(paths.updaterDir);
    return measureStoragePaths(paths);
  }

  clearLogsAndTempPaths(paths);
  return measureStoragePaths(paths);
}
