import { CapacitorHttp, registerPlugin } from "@capacitor/core";
import type { PikaShell, Server } from "@pika/shell-ui/host";
import { classifyHealth, normalizeServerUrl } from "@pika/shell-ui/servers";

interface PikaHostPlugin {
  listServers(): Promise<{ servers: Server[]; lastServerId: string | null; activeServerId: string | null }>;
  saveServer(input: { id?: string; name: string; url: string }): Promise<Server>;
  removeServer(input: { id: string }): Promise<void>;
  connect(input: { id: string }): Promise<void>;
  returnToServer(): Promise<void>;
  setCanGoBack(input: { canGoBack: boolean }): Promise<void>;
  checkForUpdates(): Promise<void>;
}

const PikaHost = registerPlugin<PikaHostPlugin>("PikaHost");

const backListeners = new Set<() => void>();
Object.defineProperty(window, "__pikaShellBack", {
  value: () => {
    for (const listener of [...backListeners]) listener();
  },
  writable: false,
  configurable: false,
  enumerable: false,
});

window.pikaShell = {
  appVersion: __APP_VERSION__,
  listServers: () => PikaHost.listServers(),
  saveServer: (input) => PikaHost.saveServer(input),
  removeServer: (id) => PikaHost.removeServer({ id }),
  checkServer: async (raw) => {
    const url = normalizeServerUrl(raw);
    if (!url) throw new Error("invalid url");
    try {
      const res = await CapacitorHttp.get({
        url: `${url}/api/health`,
        connectTimeout: 5000,
        readTimeout: 5000,
      });
      return classifyHealth(res.status >= 200 && res.status < 300, res.data);
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  },
  connect: (id) => PikaHost.connect({ id }),
  returnToServer: () => PikaHost.returnToServer(),
  setCanGoBack: (canGoBack) => {
    void PikaHost.setCanGoBack({ canGoBack });
  },
  onBack: (listener) => {
    backListeners.add(listener);
    return () => {
      backListeners.delete(listener);
    };
  },
  checkForUpdates: () => PikaHost.checkForUpdates(),
} satisfies PikaShell;

await import("@pika/shell-ui/app");
