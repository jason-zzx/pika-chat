import { contextBridge, ipcRenderer } from "electron";
import type { DesktopThemeColors, PikaShell, ServerMenuData, TitlebarState } from "@pika/shell-ui/host";

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
