import { contextBridge, ipcRenderer } from "electron";

const prefix = "--pika-server-name=";
const serverName = decodeURIComponent(process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "");

contextBridge.exposeInMainWorld("pikaNative", {
  serverName,
  appVersion: __APP_VERSION__,
  notify: (input: { title: string; body: string; path: string }) => ipcRenderer.send("native:notify", input),
  showServerMenu: (anchor: { x: number; y: number }) => ipcRenderer.send("native:showServerMenu", anchor),
  openServers: (screen: "list" | "add") => ipcRenderer.send("native:openServers", screen),
});
