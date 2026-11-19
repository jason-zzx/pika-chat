export type Server = { id: string; name: string; url: string };

export type ServerCheck =
  | { ok: true; version: string | null }
  | { ok: false; reason: "unreachable" | "not-pika" };

export interface PikaShell {
  appVersion: string;
  listServers(): Promise<{ servers: Server[]; lastServerId: string | null }>;
  saveServer(input: { id?: string; name: string; url: string }): Promise<Server>;
  removeServer(id: string): Promise<void>;
  checkServer(url: string): Promise<ServerCheck>;
  connect(id: string): Promise<void>;
  checkForUpdates(): Promise<void>;
  desktop?: {
    openLocalLog(): Promise<void>;
    getLocalError(): Promise<string | null>;
    getHotkey(): Promise<string | null>;
    setHotkey(accelerator: string | null): Promise<{ ok: boolean }>;
  };
}

declare global {
  interface Window {
    pikaShell: PikaShell;
  }
}
