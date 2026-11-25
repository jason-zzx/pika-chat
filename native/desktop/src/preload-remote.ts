import { contextBridge, ipcRenderer } from "electron";

const argument = (prefix: string) => process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
const serverName = decodeURIComponent(argument("--pika-server-name=") ?? "");
const connectedSince = Number(argument("--pika-connected-since=") ?? 0);

contextBridge.exposeInMainWorld("pikaNative", {
  serverName,
  appVersion: __APP_VERSION__,
  connectedSince,
  notify: (input: { title: string; body: string; path: string }) => ipcRenderer.send("native:notify", input),
  showServerMenu: (anchor: { x: number; y: number }) => ipcRenderer.send("native:showServerMenu", anchor),
  openServers: (screen: "list" | "add") => ipcRenderer.send("native:openServers", screen),
  navigation: {
    setCanGoBack: (canGoBack: boolean) => ipcRenderer.send("native:navState", { canGoBack }),
    onBack: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("native:back", handler);
      return () => {
        ipcRenderer.removeListener("native:back", handler);
      };
    },
  },
  desktop: {
    platform: process.platform as "win32" | "linux" | "darwin",
    getSettings: () => ipcRenderer.invoke("native:desktop:getSettings"),
    setCloseAction: (action: "tray" | "quit") => ipcRenderer.invoke("native:desktop:setCloseAction", action),
    setHotkey: (accelerator: string | null) => ipcRenderer.invoke("native:desktop:setHotkey", accelerator),
    getStorageUsage: () => ipcRenderer.invoke("native:desktop:getStorageUsage"),
    clearStorage: (category: "webCache" | "updaterCache" | "logsAndTemp") =>
      ipcRenderer.invoke("native:desktop:clearStorage", category),
    openLocalDataFolder: () => ipcRenderer.invoke("native:desktop:openLocalDataFolder"),
    checkForUpdates: () => ipcRenderer.invoke("native:desktop:checkForUpdates"),
    openDevTools: () => ipcRenderer.invoke("native:desktop:openDevTools"),
    openDesktopLog: () => ipcRenderer.invoke("native:desktop:openDesktopLog"),
    setDeveloperMode: (enabled: boolean) => ipcRenderer.invoke("native:desktop:setDeveloperMode", enabled),
  },
});

function installThemeObserver() {
  let lastKey = "";
  let canvasCtx: CanvasRenderingContext2D | null = null;

  const ensureCtx = () => {
    if (!canvasCtx) {
      canvasCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (canvasCtx) {
        canvasCtx.canvas.width = 1;
        canvasCtx.canvas.height = 1;
      }
    }
    return canvasCtx;
  };

  const sampleRgba = (css: string): [number, number, number, number] | null => {
    const ctx = ensureCtx();
    if (!ctx || !css) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#00000000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] ?? 0;
    if (a === 0) return null;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, a];
  };

  const formatRgba = ([r, g, b, a]: [number, number, number, number], opaque = false): string =>
    a === 255 || opaque
      ? `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
      : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;

  const toCss = (css: string, fallback: string, opaque = false): string => {
    const rgba = sampleRgba(css);
    return rgba ? formatRgba(rgba, opaque) : fallback;
  };

  const mqDesktop = window.matchMedia("(min-width: 768px)");

  const sendTheme = () => {
    if (!document.body) return;
    const bodyStyle = getComputedStyle(document.body);
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.append(probe);
    const readVar = (name: string) => {
      if (!bodyStyle.getPropertyValue(name).trim()) return "";
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };

    const metaThemeColor = document.querySelector('meta[name="theme-color"]')?.getAttribute("content")?.trim() ?? "";
    const bgSample = sampleRgba(metaThemeColor || readVar("--background") || bodyStyle.backgroundColor);
    const isDark = bgSample
      ? 0.2126 * bgSample[0] + 0.7152 * bgSample[1] + 0.0722 * bgSample[2] < 128
      : document.documentElement.classList.contains("dark") ||
        (!document.documentElement.classList.contains("light") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
    const fallbackBg = isDark ? "#0a0a0a" : "#fafafa";
    const fallbackFg = isDark ? "#fafafa" : "#0a0a0a";
    const background = bgSample ? formatRgba(bgSample, true) : fallbackBg;
    const foreground = toCss(readVar("--foreground") || bodyStyle.color, fallbackFg);
    const sidebarEl = document.querySelector('[data-slot="sidebar"]');
    const sidebarActive = sidebarEl !== null && mqDesktop.matches;
    const sidebarBg = sidebarActive ? toCss(readVar("--sidebar"), "", true) : "";
    // The web app's ThemeSync writes `pika_theme=<mode>:<resolved>:<preset>` (older servers omit `:<preset>`).
    // A mode switch that changes no class (system -> dark on a dark OS) still rewrites meta[theme-color].
    const [mode, , preset = "default"] = /(?:^|;\s*)pika_theme=([^;]*)/.exec(document.cookie)?.[1]?.split(":") ?? [];
    const palette = {
      isDark,
      background,
      foreground,
      mutedForeground: toCss(readVar("--muted-foreground"), isDark ? "#a3a3a3" : "#737373"),
      popover: toCss(readVar("--popover") || background, isDark ? "#171717" : "#ffffff", true),
      popoverForeground: toCss(readVar("--popover-foreground") || foreground, fallbackFg),
      accent: toCss(readVar("--accent"), isDark ? "#262626" : "#f5f5f5"),
      accentForeground: toCss(readVar("--accent-foreground") || foreground, fallbackFg),
      border: toCss(readVar("--border"), isDark ? "rgba(255, 255, 255, 0.1)" : "#e5e5e5"),
      titlebarBackground: sidebarBg || background,
      titlebarBorderless: sidebarActive && Boolean(sidebarBg) && sidebarEl.getAttribute("data-variant") === "inset",
      mode,
      preset,
    };
    probe.remove();
    const key = JSON.stringify(palette);
    if (key === lastKey) return;
    lastKey = key;
    ipcRenderer.send("native:theme", palette);
  };

  const attach = () => {
    const schedule = () => requestAnimationFrame(sendTheme);
    sendTheme();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      new MutationObserver(schedule).observe(meta, {
        attributes: true,
        attributeFilter: ["content"],
      });
    }
    new MutationObserver(schedule).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
    mqDesktop.addEventListener("change", schedule);
    window.addEventListener("pika:chrome-sync", schedule);
    window.addEventListener("popstate", schedule);
    const nav = (window as Window & { navigation?: EventTarget }).navigation;
    nav?.addEventListener("currententrychange", schedule);
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
  window.addEventListener("load", sendTheme, { once: true });
}

if (window === window.top) {
  installThemeObserver();
}
