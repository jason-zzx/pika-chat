export type Server = { id: string; name: string; url: string };

export type ServerCheck =
  | { ok: true; version: string | null }
  | { ok: false; reason: "unreachable" | "not-pika" };

// The last connected server's theme preference (its `pika_theme` cookie). Hosts apply it to shell-ui
// pages before their first frame (`.dark` + `data-theme`).
export type ShellAppearance = { mode: "light" | "dark" | "system"; preset: string };

export type DesktopThemeColors = {
  isDark: boolean;
  background: string;
  foreground: string;
  mutedForeground: string;
  popover: string;
  popoverForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  titlebarBackground?: string;
  titlebarBorderless?: boolean;
};

export type TitlebarState = {
  platform: "win32" | "linux" | "darwin";
  title: string;
  isMaximized: boolean;
  theme: DesktopThemeColors;
};

export type ServerMenuData = {
  servers: Server[];
  activeServerId: string | null;
  localName: string;
  anchor: { x: number; y: number };
  theme: DesktopThemeColors;
};

export interface PikaShell {
  appVersion: string;
  listServers(): Promise<{ servers: Server[]; lastServerId: string | null; activeServerId: string | null }>;
  saveServer(input: { id?: string; name: string; url: string }): Promise<Server>;
  removeServer(id: string): Promise<void>;
  checkServer(url: string): Promise<ServerCheck>;
  connect(id: string): Promise<void>;
  returnToServer(): Promise<void>;
  setCanGoBack?(canGoBack: boolean): void;
  onBack?(listener: () => void): () => void;
  checkForUpdates(): Promise<void>;
  desktop?: {
    openLocalLog(): Promise<void>;
    getLocalError(): Promise<string | null>;
    setTheme(theme: DesktopThemeColors): void;
    getDeveloperMode(): Promise<boolean>;
    setDeveloperMode(enabled: boolean): Promise<void>;
    openDevTools(): Promise<void>;
    openDesktopLog(): Promise<void>;
    windowControls: {
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
      getState(): Promise<TitlebarState>;
      onState(listener: (state: TitlebarState) => void): () => void;
    };
    serverMenu: {
      getData(): Promise<ServerMenuData | null>;
      onData(listener: (data: ServerMenuData) => void): () => void;
      select(id: string): void;
      open(screen: "add" | "list"): void;
      close(): void;
    };
  };
}

declare global {
  interface Window {
    pikaShell: PikaShell;
  }
}
