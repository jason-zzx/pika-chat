import { isNewerVersion } from "@pika/shell-ui/servers";
import { app, dialog, net, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Strings } from "./i18n";

const RELEASES_URL = "https://github.com/jason-zzx/pika-chat/releases/latest";
const LATEST_API = "https://api.github.com/repos/jason-zzx/pika-chat/releases/latest";

const latestRelease = z.object({ tag_name: z.string(), html_url: z.string() });

function supportsAutoInstall(): boolean {
  if (process.platform === "darwin" || !app.isPackaged) return false;
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) return false;
  if (process.platform === "win32") {
    const exeDir = dirname(app.getPath("exe"));
    if (!existsSync(join(exeDir, "Uninstall Pika Chat.exe"))) return false;
  }
  return true;
}

// Dialogs have no parent window: an update can finish downloading while the window is hidden in the
// tray, and a dialog attached to a hidden window may never appear.
export function createUpdater(t: Strings, beforeInstall: () => Promise<void>) {
  const message = (text: string, buttons: string[], type: "info" | "error" = "info") =>
    dialog.showMessageBox({ type, message: text, buttons, defaultId: 0, cancelId: buttons.length - 1 });

  const reportFailure = async () => {
    const { response } = await message(t.updateError, [t.download, t.later], "error");
    if (response === 0) await shell.openExternal(RELEASES_URL);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("error", (error) => {
    console.error("updater:", error);
    void reportFailure();
  });
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await message(t.updateReady(info.version), [t.restartInstall, t.later]);
    if (response !== 0) return;
    // The installer starts inside quitAndInstall and force-kills every "Pika Chat" process within
    // ~2.6 s, the local server included, and its open files block the overwrite on Windows: stop the
    // server first.
    await beforeInstall();
    autoUpdater.quitAndInstall();
  });

  async function checkReleasePrompt() {
    const res = await net.fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } }).catch(() => null);
    const parsed = res?.ok ? latestRelease.safeParse(await res.json()) : null;
    if (!parsed?.success) {
      await reportFailure();
      return;
    }
    const release = parsed.data;
    if (!isNewerVersion(release.tag_name, __APP_VERSION__)) {
      await message(t.upToDate(__APP_VERSION__), [t.ok]);
      return;
    }
    const { response } = await message(t.updateAvailable(release.tag_name.replace(/^v/, "")), [t.download, t.later]);
    if (response === 0) await shell.openExternal(release.html_url);
  }

  return async function check() {
    if (!supportsAutoInstall()) return checkReleasePrompt();
    const result = await autoUpdater.checkForUpdates().catch(() => undefined);
    if (result === undefined) return;
    if (!result?.isUpdateAvailable) {
      await message(t.upToDate(__APP_VERSION__), [t.ok]);
      return;
    }
    await message(t.updateDownloading(result.updateInfo.version), [t.ok]);
  };
}
