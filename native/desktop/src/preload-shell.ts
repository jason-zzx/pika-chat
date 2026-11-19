import { contextBridge, ipcRenderer } from "electron";
import type { PikaShell } from "@pika/shell-ui/host";

const shell: PikaShell = {
  appVersion: __APP_VERSION__,
  listServers: () => ipcRenderer.invoke("shell:listServers"),
  saveServer: (input) => ipcRenderer.invoke("shell:saveServer", input),
  removeServer: (id) => ipcRenderer.invoke("shell:removeServer", id),
  checkServer: (url) => ipcRenderer.invoke("shell:checkServer", url),
  connect: (id) => ipcRenderer.invoke("shell:connect", id),
  checkForUpdates: () => ipcRenderer.invoke("shell:checkForUpdates"),
  desktop: {
    openLocalLog: () => ipcRenderer.invoke("shell:openLocalLog"),
    getLocalError: () => ipcRenderer.invoke("shell:getLocalError"),
    getHotkey: () => ipcRenderer.invoke("shell:getHotkey"),
    setHotkey: (accelerator) => ipcRenderer.invoke("shell:setHotkey", accelerator),
  },
};

contextBridge.exposeInMainWorld("pikaShell", shell);
