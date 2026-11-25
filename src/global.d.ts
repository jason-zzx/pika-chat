import type { locales } from "@/i18n/locales";

import messages from "../messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: typeof messages;
  }
}

declare global {
  type DesktopCloseAction = "tray" | "quit";
  type DesktopStorageCategory = "webCache" | "updaterCache" | "logsAndTemp";

  interface DesktopStorageUsage {
    localDataBytes: number;
    webCacheBytes: number;
    updaterCacheBytes: number;
    logsAndTempBytes: number;
  }

  interface DesktopSettings {
    closeAction: DesktopCloseAction;
    hotkey: string | null;
    developerMode: boolean;
  }

  interface PikaNativeDesktop {
    platform: "win32" | "linux" | "darwin";
    getSettings(): Promise<DesktopSettings>;
    setCloseAction(action: DesktopCloseAction): Promise<void>;
    setHotkey(accelerator: string | null): Promise<{ ok: boolean }>;
    getStorageUsage(): Promise<DesktopStorageUsage>;
    clearStorage(category: DesktopStorageCategory): Promise<DesktopStorageUsage>;
    openLocalDataFolder(): Promise<void>;
    checkForUpdates(): Promise<void>;
    openDevTools(): Promise<void>;
    openDesktopLog(): Promise<void>;
    setDeveloperMode(enabled: boolean): Promise<void>;
  }

  interface PikaNativeNavigation {
    setCanGoBack(canGoBack: boolean): void;
    onBack(listener: () => void): () => void;
  }

  interface PikaNative {
    serverName: string;
    appVersion?: string;
    /** Epoch ms when the shell last switched to this server (reconnecting the
     * same one keeps it); composer drafts written earlier are discarded.
     * Absent in older shells. */
    connectedSince?: number;
    notify(input: { title: string; body: string; path: string }): void;
    showServerMenu(anchor: { x: number; y: number }): void;
    openServers(screen: "list" | "add"): void;
    /** Topic id of the temporary chat open in this page, or null. Optional: older shells lack it. */
    setTemporaryTopic?(topicId: string | null): void;
    navigation?: PikaNativeNavigation;
    desktop?: PikaNativeDesktop;
  }

  interface Window {
    pikaNative?: PikaNative;
  }
}
