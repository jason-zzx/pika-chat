import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopThemeColors,
  PikaShell,
  ServerMenuData,
  ShellAppearance,
  TitlebarState,
} from "@pika/shell-ui/host";

const subscribe = <T>(channel: string, listener: (payload: T) => void) => {
  const handler = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const shell: PikaShell = {
  appVersion: __APP_VERSION__,
  listServers: () => ipcRenderer.invoke("shell:listServers"),
  saveServer: (input) => ipcRenderer.invoke("shell:saveServer", input),
  removeServer: (id) => ipcRenderer.invoke("shell:removeServer", id),
  checkServer: (url) => ipcRenderer.invoke("shell:checkServer", url),
  connect: (id) => ipcRenderer.invoke("shell:connect", id),
  returnToServer: () => ipcRenderer.invoke("shell:returnToServer"),
  onBack: (listener) => subscribe("shell:back", () => listener()),
  checkForUpdates: () => ipcRenderer.invoke("shell:checkForUpdates"),
  desktop: {
    openLocalLog: () => ipcRenderer.invoke("shell:openLocalLog"),
    getLocalError: () => ipcRenderer.invoke("shell:getLocalError"),
    setTheme: (theme: DesktopThemeColors) => ipcRenderer.send("shell:setTheme", theme),
    getDeveloperMode: () => ipcRenderer.invoke("shell:getDeveloperMode"),
    setDeveloperMode: (enabled: boolean) => ipcRenderer.invoke("shell:setDeveloperMode", enabled),
    openDevTools: () => ipcRenderer.invoke("shell:openDevTools"),
    openDesktopLog: () => ipcRenderer.invoke("shell:openDesktopLog"),
    windowControls: {
      minimize: () => ipcRenderer.send("titlebar:minimize"),
      toggleMaximize: () => ipcRenderer.send("titlebar:toggleMaximize"),
      close: () => ipcRenderer.send("titlebar:close"),
      getState: () => ipcRenderer.invoke("titlebar:getState"),
      onState: (listener: (state: TitlebarState) => void) => subscribe("titlebar:state", listener),
    },
    serverMenu: {
      getData: () => ipcRenderer.invoke("serverMenu:getData"),
      onData: (listener: (data: ServerMenuData) => void) => subscribe("serverMenu:data", listener),
      select: (id: string) => ipcRenderer.send("serverMenu:select", id),
      open: (screen: "add" | "list") => ipcRenderer.send("serverMenu:open", screen),
      close: () => ipcRenderer.send("serverMenu:close"),
    },
  },
};

contextBridge.exposeInMainWorld("pikaShell", shell);

// Shell pages take the last server's appearance before their first frame: a light frame painted first would
// stay on screen when auto-connect detaches the view, and flash on the next showShell. The preload runs
// before <html> exists; the mutation callback still runs before the first paint.
if (!new URLSearchParams(location.search).has("chrome")) {
  const appearance: ShellAppearance = ipcRenderer.sendSync("shell:getAppearance");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const applyDark = () =>
    document.documentElement.classList.toggle(
      "dark",
      appearance.mode === "dark" || (appearance.mode === "system" && systemDark.matches),
    );
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    // "default" and presets this build does not know match no [data-theme] block: base tokens apply.
    document.documentElement.dataset.theme = appearance.preset;
    applyDark();
    systemDark.addEventListener("change", applyDark);
  });
  observer.observe(document, { childList: true });
}
