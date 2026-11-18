import { contextBridge, ipcRenderer } from "electron";
import type { PikaShell } from "@pika/shell-ui/host";

const shell: PikaShell = {
  appVersion: __APP_VERSION__,
  listServers: () => ipcRenderer.invoke("shell:listServers"),
  saveServer: (input) => ipcRenderer.invoke("shell:saveServer", input),
  removeServer: (id) => ipcRenderer.invoke("shell:removeServer", id),
  checkServer: (url) => ipcRenderer.invoke("shell:checkServer", url),
  connect: (id) => ipcRenderer.invoke("shell:connect", id),
  getHotkey: () => ipcRenderer.invoke("shell:getHotkey"),
  setHotkey: (accelerator) => ipcRenderer.invoke("shell:setHotkey", accelerator),
  checkForUpdates: () => ipcRenderer.invoke("shell:checkForUpdates"),
};

contextBridge.exposeInMainWorld("pikaShell", shell);
