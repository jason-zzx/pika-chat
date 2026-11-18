import { app, dialog, net, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { z } from "zod";
import type { Strings } from "./i18n";

const RELEASES_URL = "https://github.com/jason-zzx/pika-chat/releases/latest";
const LATEST_API = "https://api.github.com/repos/jason-zzx/pika-chat/releases/latest";

const latestRelease = z.object({ tag_name: z.string(), html_url: z.string() });

// Dialogs have no parent window: an update can finish downloading while the window is hidden in the
// tray, and a dialog attached to a hidden window may never appear.
export function createUpdater(t: Strings) {
  // Errors from a launch-time check stay silent; a manual check or an install attempt reports them.
  let reportErrors = false;

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
    if (reportErrors) void reportFailure();
  });
  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await message(t.updateReady(info.version), [t.restartInstall, t.later]);
    if (response !== 0) return;
    reportErrors = true;
    autoUpdater.quitAndInstall();
  });

  async function checkMac(manual: boolean) {
    const res = await net.fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } }).catch(() => null);
    const parsed = res?.ok ? latestRelease.safeParse(await res.json()) : null;
    if (!parsed?.success) {
      if (manual) await reportFailure();
      return;
    }
    const release = parsed.data;
    // releases/latest is always the newest stable release, so any other tag is an update.
    if (release.tag_name === `v${__APP_VERSION__}`) {
      if (manual) await message(t.upToDate(__APP_VERSION__), [t.ok]);
      return;
    }
    const { response } = await message(t.updateAvailable(release.tag_name.replace(/^v/, "")), [t.download, t.later]);
    if (response === 0) await shell.openExternal(release.html_url);
  }

  return async function check(manual: boolean) {
    if (process.platform === "darwin") return checkMac(manual);
    if (!app.isPackaged) return;
    reportErrors = manual;
    const result = await autoUpdater.checkForUpdates().catch(() => undefined);
    if (!manual || result === undefined) return;
    if (!result?.isUpdateAvailable) {
      await message(t.upToDate(__APP_VERSION__), [t.ok]);
      return;
    }
    await message(t.updateDownloading(result.updateInfo.version), [t.ok]);
  };
}
