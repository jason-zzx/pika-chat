import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { DesktopThemeColors, Server, ServerMenuData, TitlebarState } from "@pika/shell-ui/host";
import { classifyHealth, normalizeServerUrl } from "@pika/shell-ui/servers";
import { loadStrings } from "./i18n";
import { createLocalServer, localPaths } from "./local-server";
import { clearStorageCategory, desktopLogPath, measureStorageUsage } from "./storage";
import { closeActionSchema, loadConfig, saveConfig } from "./store";
import { createUpdater } from "./updater";

const LOCAL_SERVER_ID = "local";
const APP_ID = "io.github.jason-zzx.pika-chat";
const TITLEBAR_HEIGHT = 34;
const MAX_LOG_BYTES = 1024 * 1024;
const isMac = process.platform === "darwin";
const downloadsDir = join(tmpdir(), "pika-chat");

const notifyInput = z.object({
  title: z.string().max(200),
  body: z.string().max(500),
  path: z.string().startsWith("/").max(2048),
});

const anchorInput = z.object({ x: z.number().finite(), y: z.number().finite() });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const cssColor = z
  .string()
  .regex(
    /^(?:#[0-9a-fA-F]{6}|rgba\((?:25[0-5]|2[0-4]\d|1?\d?\d), (?:25[0-5]|2[0-4]\d|1?\d?\d), (?:25[0-5]|2[0-4]\d|1?\d?\d), (?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)\))$/,
  );

const themeInput = z.object({
  isDark: z.boolean(),
  background: hexColor,
  foreground: cssColor,
  mutedForeground: cssColor,
  popover: hexColor,
  popoverForeground: cssColor,
  accent: cssColor,
  accentForeground: cssColor,
  border: cssColor,
  titlebarBackground: hexColor.optional(),
  titlebarBorderless: z.boolean().optional(),
});

const storageCategoryInput = z.enum(["webCache", "updaterCache", "logsAndTemp"]);

// Downloaded files with these extensions open in the OS default app; anything else (scripts, code,
// executables, which Windows would run on open) is revealed in the file manager instead.
const OPENABLE_EXTENSIONS = new Set(
  (
    "pdf png jpg jpeg gif webp bmp avif heic mp3 wav ogg oga m4a flac aac opus mp4 webm mov mkv m4v " +
    "docx xlsx pptx odt ods odp epub txt md csv tsv log"
  ).split(" "),
);

function defaultTheme(isDark: boolean): DesktopThemeColors {
  return isDark
    ? {
        isDark: true,
        background: "#0a0a0a",
        foreground: "#fafafa",
        mutedForeground: "#a3a3a3",
        popover: "#171717",
        popoverForeground: "#fafafa",
        accent: "#262626",
        accentForeground: "#fafafa",
        border: "rgba(255, 255, 255, 0.1)",
      }
    : {
        isDark: false,
        background: "#fafafa",
        foreground: "#0a0a0a",
        mutedForeground: "#737373",
        popover: "#ffffff",
        popoverForeground: "#0a0a0a",
        accent: "#f5f5f5",
        accentForeground: "#0a0a0a",
        border: "#e5e5e5",
      };
}

function initDesktopLog() {
  const path = desktopLogPath();
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    // ignore log rotation error
  }
}

function logDesktop(level: "info" | "warn" | "error", message: string) {
  try {
    appendFileSync(desktopLogPath(), `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`);
  } catch {
    // ignore log write failure
  }
}

const openExternal = (url: string) => {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
};

if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(start);
}

function start() {
  initDesktopLog();
  logDesktop("info", `App started v${__APP_VERSION__} on ${process.platform}`);

  const config = loadConfig();
  const t = loadStrings(app.getLocale());
  const localServer = createLocalServer();
  const icon = nativeImage.createFromPath(join(__dirname, "assets", "icon.png"));
  const shellUrl = pathToFileURL(join(__dirname, "shell-ui", "index.html")).href;

  rmSync(downloadsDir, { recursive: true, force: true });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  let currentTheme = defaultTheme(nativeTheme.shouldUseDarkColors);

  const saved = config.windowState;
  const restorable =
    saved !== null &&
    screen.getAllDisplays().some(({ workArea: a }) => {
      const b = saved.bounds;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    ...(restorable ? saved.bounds : {}),
    minWidth: 640,
    minHeight: 480,
    title: "Pika Chat",
    icon,
    frame: isMac,
    ...(isMac ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 10 } } : {}),
    autoHideMenuBar: true,
    backgroundColor: currentTheme.background,
  });
  if (restorable && saved.isMaximized) win.maximize();

  // contextIsolation and sandbox are on and nodeIntegration off by Electron's defaults.
  const webPreferences = (preload: string) => ({ preload: join(__dirname, preload) });

  const createShellView = (query?: string) => {
    const view = new WebContentsView({ webPreferences: webPreferences("preload-shell.js") });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    if (query) void view.webContents.loadURL(`${shellUrl}${query}`);
    return view;
  };

  const titlebarView = createShellView("?chrome=titlebar");
  const shellView = createShellView();
  const serverMenuView = createShellView("?chrome=menu");
  serverMenuView.setBackgroundColor("#00000000");

  let remote: { view: WebContentsView; server: Server; partition: string } | null = null;
  let serverMenuOpen = false;
  let lastMenuData: ServerMenuData | null = null;

  const activeView = () => remote?.view ?? shellView;
  const windowTitle = () => (remote ? `${remote.server.name} · Pika Chat` : "Pika Chat");

  const getTitlebarState = (): TitlebarState => ({
    platform: process.platform as "win32" | "linux" | "darwin",
    title: windowTitle(),
    isMaximized: win.isMaximized(),
    theme: currentTheme,
  });

  const emitTitlebarState = () => {
    win.setTitle(windowTitle());
    if (!titlebarView.webContents.isDestroyed()) {
      titlebarView.webContents.send("titlebar:state", getTitlebarState());
    }
  };

  const applyTheme = (theme: DesktopThemeColors) => {
    currentTheme = theme;
    win.setBackgroundColor(theme.titlebarBackground ?? theme.background);
    emitTitlebarState();
    if (lastMenuData) {
      lastMenuData = { ...lastMenuData, theme };
      if (serverMenuOpen && !serverMenuView.webContents.isDestroyed()) {
        serverMenuView.webContents.send("serverMenu:data", lastMenuData);
      }
    }
  };

  const closeServerMenu = () => {
    if (!serverMenuOpen) return;
    serverMenuOpen = false;
    win.contentView.removeChildView(serverMenuView);
    if (!activeView().webContents.isDestroyed()) activeView().webContents.focus();
  };

  const layout = () => {
    if (win.isMinimized()) return;
    const [width, height] = win.getContentSize();
    if (!width || !height) return;
    const barHeight = win.isFullScreen() ? 0 : TITLEBAR_HEIGHT;
    titlebarView.setBounds({ x: 0, y: 0, width, height: barHeight });
    const contentBounds = { x: 0, y: barHeight, width, height: Math.max(0, height - barHeight) };
    activeView().setBounds(contentBounds);
    if (serverMenuOpen) serverMenuView.setBounds(contentBounds);
  };

  const repaintVisibleViews = () => {
    if (win.isMinimized() || !win.isVisible()) return;
    if (!titlebarView.webContents.isDestroyed()) titlebarView.webContents.invalidate();
    if (!activeView().webContents.isDestroyed()) activeView().webContents.invalidate();
  };

  const attach = (view: WebContentsView) => {
    closeServerMenu();
    for (const child of win.contentView.children) win.contentView.removeChildView(child);
    win.contentView.addChildView(titlebarView);
    win.contentView.addChildView(view);
    layout();
    emitTitlebarState();
    view.webContents.focus();
  };

  win.on("resize", () => {
    closeServerMenu();
    layout();
  });
  win.on("minimize", () => {
    closeServerMenu();
    logDesktop("info", "window minimized");
  });
  win.on("restore", () => {
    layout();
    repaintVisibleViews();
    emitTitlebarState();
    logDesktop("info", "window restored");
  });
  win.on("show", () => {
    layout();
    repaintVisibleViews();
    emitTitlebarState();
    rebuildTray();
  });
  win.on("hide", () => {
    closeServerMenu();
    rebuildTray();
  });
  win.on("blur", closeServerMenu);
  win.on("maximize", () => {
    closeServerMenu();
    layout();
    repaintVisibleViews();
    emitTitlebarState();
  });
  win.on("unmaximize", () => {
    closeServerMenu();
    layout();
    repaintVisibleViews();
    emitTitlebarState();
  });
  win.on("enter-full-screen", () => {
    closeServerMenu();
    layout();
    emitTitlebarState();
  });
  win.on("leave-full-screen", () => {
    layout();
    repaintVisibleViews();
    emitTitlebarState();
  });
  // Focusing the window focuses the BrowserWindow's own empty webContents, not the attached view:
  // the page would report document.hasFocus() false (and notify about replies) while in front.
  // backgroundThrottling: false also keeps visibilityState "visible", so focus is the only signal.
  win.on("focus", () => {
    if (serverMenuOpen) serverMenuView.webContents.focus();
    else activeView().webContents.focus();
  });

  const showWindow = () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    layout();
    repaintVisibleViews();
  };
  const toggleWindow = () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow());

  const closeRemote = () => {
    closeServerMenu();
    if (!remote) return;
    win.contentView.removeChildView(remote.view);
    remote.view.webContents.close();
    remote = null;
  };

  // query: "" auto-connects to the last server, "?list" shows the list, "?add" the add form,
  // "?connect=<id>" connects to that server, "?failed=<id>" the load error.
  const showShell = (query: string) => {
    closeRemote();
    attach(shellView);
    void shellView.webContents.loadURL(shellUrl + query);
    rebuildTray();
  };

  const attachCrashRecovery = (contents: WebContents, label: string, onRepeatedCrash: () => void) => {
    let lastCrashAt = 0;
    contents.on("render-process-gone", (_event, details) => {
      logDesktop("error", `${label} render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
      if (details.reason === "clean-exit") return;
      const now = Date.now();
      if (now - lastCrashAt < 10_000) {
        onRepeatedCrash();
        return;
      }
      lastCrashAt = now;
      contents.reload();
    });
    contents.on("unresponsive", () => logDesktop("warn", `${label} unresponsive`));
    contents.on("responsive", () => logDesktop("info", `${label} responsive`));
  };

  attachCrashRecovery(titlebarView.webContents, "titlebarView", () => {
    void titlebarView.webContents.loadURL(`${shellUrl}?chrome=titlebar`);
  });
  attachCrashRecovery(shellView.webContents, "shellView", () => {
    void shellView.webContents.loadURL(`${shellUrl}?list`);
  });
  attachCrashRecovery(serverMenuView.webContents, "serverMenuView", closeServerMenu);

  app.on("child-process-gone", (_event, details) => {
    logDesktop("error", `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.type === "GPU") {
      layout();
      repaintVisibleViews();
    }
  });

  const securedSessions = new Set<Session>();
  const pendingOpen = new Set<string>();

  const secureSession = (ses: Session) => {
    if (securedSessions.has(ses)) return;
    securedSessions.add(ses);
    const allowed = (permission: string) => permission === "clipboard-sanitized-write";
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed(permission));
    ses.on("will-download", (_event, item) => {
      if (!pendingOpen.delete(item.getURLChain()[0] ?? "")) return;
      mkdirSync(downloadsDir, { recursive: true });
      const path = join(mkdtempSync(join(downloadsDir, "dl-")), basename(item.getFilename()));
      item.setSavePath(path);
      item.once("done", (_e, state) => {
        if (state !== "completed") return;
        if (OPENABLE_EXTENSIONS.has(extname(path).slice(1).toLowerCase())) void shell.openPath(path);
        else shell.showItemInFolder(path);
      });
    });
  };

  const guardRemote = (contents: WebContents, server: Server) => {
    contents.setWindowOpenHandler(({ url }) => {
      const target = new URL(url);
      if (target.origin !== server.url) {
        openExternal(url);
      } else if (/^\/api\/files\/[^/]+$/.test(target.pathname)) {
        pendingOpen.add(target.href);
        contents.session.downloadURL(target.href);
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (new URL(url).origin === server.url) return;
      event.preventDefault();
      openExternal(url);
    });
    if (server.id === LOCAL_SERVER_ID) {
      // Local mode has no sign-in page: a lapsed session signs in again and reloads the app. Server
      // redirects arrive as will-redirect, client router pushes as did-navigate-in-page, and
      // location.replace() as will-navigate.
      const isAuthPage = (url: string) => /^\/(sign-in|setup)(\/|$)/.test(new URL(url).pathname);
      const signInAgain = () =>
        void localServer
          .signIn(contents.session)
          .then(() => contents.loadURL(server.url))
          .catch(() => setImmediate(() => showShell("?failed=local")));
      const intercept = (event: { preventDefault(): void; url: string; isMainFrame: boolean }) => {
        if (!event.isMainFrame || !isAuthPage(event.url)) return;
        event.preventDefault();
        signInAgain();
      };
      contents.on("will-navigate", intercept);
      contents.on("will-redirect", intercept);
      contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
        if (isMainFrame && isAuthPage(url)) signInAgain();
      });
    }
    // -3 is ERR_ABORTED: a navigation superseded by another one, not a failure. The shell shows the
    // error without retrying: the health check can pass while the page itself fails to load.
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        logDesktop("warn", `did-fail-load server=${server.id} code=${code} desc=${description} url=${url}`);
        setImmediate(() => showShell(`?failed=${encodeURIComponent(server.id)}`));
      }
    });
    attachCrashRecovery(contents, `remote(${server.id})`, () =>
      setImmediate(() => showShell(`?failed=${encodeURIComponent(server.id)}`)),
    );
  };

  const attachServerView = (server: Server, partition: string, url: string) => {
    closeRemote();
    const view = new WebContentsView({
      webPreferences: {
        ...webPreferences("preload-remote.js"),
        partition,
        additionalArguments: [`--pika-server-name=${encodeURIComponent(server.name)}`],
        // A reply must be able to finish, and notify, while the window sits in the tray.
        backgroundThrottling: false,
      },
    });
    secureSession(view.webContents.session);
    guardRemote(view.webContents, server);
    remote = { view, server, partition };
    void view.webContents.loadURL(url);
    attach(view);
    config.lastServerId = server.id;
    saveConfig(config);
    rebuildTray();
  };

  const connect = async (id: string) => {
    if (id === LOCAL_SERVER_ID) {
      // A failure rejects back to shell-ui, which shows the local error view.
      const origin = await localServer.ensureStarted(config, saveConfig);
      await localServer.signIn(session.fromPartition("persist:local"));
      attachServerView({ id: LOCAL_SERVER_ID, name: t.localName, url: origin }, "persist:local", origin);
      return;
    }

    const server = config.servers.find((candidate) => candidate.id === id);
    if (!server) throw new Error("unknown server");
    attachServerView(server, `persist:server-${id}`, server.url);
  };

  const applyHotkey = (accelerator: string | null) => {
    globalShortcut.unregisterAll();
    if (accelerator === null) return true;
    try {
      return globalShortcut.register(accelerator, toggleWindow);
    } catch {
      return false;
    }
  };

  const checkForUpdates = createUpdater(t, localServer.shutdown);
  const manualUpdateCheck = () => {
    showWindow();
    return checkForUpdates(true);
  };

  const openDetachedDevTools = () => {
    activeView().webContents.openDevTools({ mode: "detach" });
  };

  const openDesktopLogFile = () => {
    initDesktopLog();
    if (existsSync(desktopLogPath())) shell.showItemInFolder(desktopLogPath());
    else void shell.openPath(app.getPath("userData"));
  };

  const setDeveloperMode = (enabled: boolean) => {
    config.developerMode = enabled;
    saveConfig(config);
    rebuildTray();
    rebuildAppMenu();
  };

  const knownPartitions = () => [
    "persist:local",
    ...config.servers.map((server) => `persist:server-${server.id}`),
  ];

  const handleShell = <S extends z.ZodType>(channel: string, schema: S, run: (input: z.infer<S>) => unknown) =>
    ipcMain.handle(channel, (event, raw: unknown) => {
      if (event.sender !== shellView.webContents) throw new Error("forbidden sender");
      return run(schema.parse(raw));
    });

  handleShell("shell:listServers", z.undefined(), () => ({
    servers: config.servers,
    lastServerId: config.lastServerId,
  }));
  handleShell(
    "shell:saveServer",
    z.object({ id: z.string().optional(), name: z.string().max(100), url: z.string().max(2048) }),
    (input) => {
      const url = normalizeServerUrl(input.url);
      if (!url) throw new Error("invalid url");
      const existing = config.servers.find((server) => server.id === input.id);
      const server = { id: existing?.id ?? randomUUID(), name: input.name.trim() || new URL(url).host, url };
      config.servers = existing
        ? config.servers.map((candidate) => (candidate.id === server.id ? server : candidate))
        : [...config.servers, server];
      saveConfig(config);
      rebuildTray();
      return server;
    },
  );
  handleShell("shell:removeServer", z.string(), async (id) => {
    config.servers = config.servers.filter((server) => server.id !== id);
    if (config.lastServerId === id) config.lastServerId = null;
    saveConfig(config);
    rebuildTray();
    await session.fromPartition(`persist:server-${id}`).clearStorageData();
  });
  handleShell("shell:checkServer", z.string(), async (raw) => {
    const url = normalizeServerUrl(raw);
    if (!url) throw new Error("invalid url");
    const res = await net.fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res) return { ok: false, reason: "unreachable" };
    return classifyHealth(res.ok, await res.json().catch(() => null));
  });
  handleShell("shell:connect", z.string(), connect);
  handleShell("shell:openLocalLog", z.undefined(), () => {
    shell.showItemInFolder(localPaths().logFile);
  });
  handleShell("shell:getLocalError", z.undefined(), () => localServer.lastError());
  handleShell("shell:getDeveloperMode", z.undefined(), () => config.developerMode);
  handleShell("shell:setDeveloperMode", z.boolean(), setDeveloperMode);
  handleShell("shell:openDevTools", z.undefined(), openDetachedDevTools);
  handleShell("shell:openDesktopLog", z.undefined(), openDesktopLogFile);
  handleShell("shell:checkForUpdates", z.undefined(), manualUpdateCheck);

  ipcMain.on("shell:setTheme", (event, raw: unknown) => {
    if (event.sender !== shellView.webContents) return;
    const parsed = themeInput.safeParse(raw);
    if (parsed.success && remote === null) applyTheme(parsed.data);
  });

  // Titlebar controls (titlebarView only)
  ipcMain.handle("titlebar:getState", (event) => {
    if (event.sender !== titlebarView.webContents) throw new Error("forbidden sender");
    return getTitlebarState();
  });
  ipcMain.on("titlebar:minimize", (event) => {
    if (event.sender === titlebarView.webContents) win.minimize();
  });
  ipcMain.on("titlebar:toggleMaximize", (event) => {
    if (event.sender !== titlebarView.webContents) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("titlebar:close", (event) => {
    if (event.sender === titlebarView.webContents) win.close();
  });

  // Server menu overlay controls (serverMenuView only)
  ipcMain.handle("serverMenu:getData", (event) => {
    if (event.sender !== serverMenuView.webContents) throw new Error("forbidden sender");
    return lastMenuData;
  });
  ipcMain.on("serverMenu:select", (event, raw: unknown) => {
    if (event.sender !== serverMenuView.webContents) return;
    const id = z.string().safeParse(raw);
    if (!id.success) return;
    const currentId = remote?.server.id;
    closeServerMenu();
    if (id.data !== currentId) showShell(`?connect=${encodeURIComponent(id.data)}`);
  });
  ipcMain.on("serverMenu:open", (event, raw: unknown) => {
    if (event.sender !== serverMenuView.webContents) return;
    const target = z.enum(["add", "list"]).safeParse(raw);
    closeServerMenu();
    if (target.success) showShell(`?${target.data}`);
  });
  ipcMain.on("serverMenu:close", (event) => {
    if (event.sender === serverMenuView.webContents) closeServerMenu();
  });

  const fromRemote = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    remote !== null && event.sender === remote.view.webContents && event.senderFrame?.origin === remote.server.url;

  const handleRemote = <S extends z.ZodType>(channel: string, schema: S, run: (input: z.infer<S>) => unknown) =>
    ipcMain.handle(channel, (event, raw: unknown) => {
      if (!fromRemote(event)) throw new Error("forbidden sender");
      return run(schema.parse(raw));
    });

  handleRemote("native:desktop:getSettings", z.undefined(), () => ({
    closeAction: config.closeAction,
    hotkey: config.hotkey,
    developerMode: config.developerMode,
  }));
  handleRemote("native:desktop:setCloseAction", closeActionSchema, (action) => {
    config.closeAction = action;
    saveConfig(config);
  });
  handleRemote("native:desktop:setHotkey", z.string().min(1).max(100).nullable(), (accelerator) => {
    const ok = applyHotkey(accelerator);
    if (ok) {
      config.hotkey = accelerator;
      saveConfig(config);
    } else applyHotkey(config.hotkey);
    return { ok };
  });
  handleRemote("native:desktop:getStorageUsage", z.undefined(), () => measureStorageUsage(downloadsDir));
  handleRemote("native:desktop:clearStorage", storageCategoryInput, (category) =>
    clearStorageCategory(category, downloadsDir, knownPartitions()),
  );
  handleRemote("native:desktop:openLocalDataFolder", z.undefined(), () => {
    const localRoot = localPaths().root;
    void shell.openPath(existsSync(localRoot) ? localRoot : app.getPath("userData"));
  });
  handleRemote("native:desktop:checkForUpdates", z.undefined(), manualUpdateCheck);
  handleRemote("native:desktop:openDevTools", z.undefined(), openDetachedDevTools);
  handleRemote("native:desktop:openDesktopLog", z.undefined(), openDesktopLogFile);
  handleRemote("native:desktop:setDeveloperMode", z.boolean(), setDeveloperMode);

  const notifications = new Set<Notification>();
  ipcMain.on("native:notify", (event, raw: unknown) => {
    const input = notifyInput.safeParse(raw);
    if (!remote || !fromRemote(event) || !input.success) return;
    const server = remote.server;
    const notification = new Notification({ title: input.data.title, body: input.data.body, icon });
    notification.on("click", () => {
      showWindow();
      if (remote?.server.id === server.id) void remote.view.webContents.loadURL(server.url + input.data.path);
    });
    notification.on("close", () => notifications.delete(notification));
    notifications.add(notification);
    notification.show();
  });

  ipcMain.on("native:theme", (event, raw: unknown) => {
    if (!fromRemote(event)) return;
    const parsed = themeInput.safeParse(raw);
    if (parsed.success) applyTheme(parsed.data);
  });

  ipcMain.on("native:showServerMenu", (event, raw: unknown) => {
    const anchor = anchorInput.safeParse(raw);
    if (!remote || !fromRemote(event) || !anchor.success) return;
    const zoom = event.sender.getZoomFactor();
    lastMenuData = {
      servers: config.servers,
      activeServerId: remote.server.id,
      localName: t.localName,
      anchor: { x: Math.round(anchor.data.x * zoom), y: Math.round(anchor.data.y * zoom) },
      theme: currentTheme,
    };
    if (!serverMenuOpen) {
      serverMenuOpen = true;
      win.contentView.addChildView(serverMenuView);
      layout();
    }
    serverMenuView.webContents.send("serverMenu:data", lastMenuData);
    serverMenuView.webContents.focus();
  });
  ipcMain.on("native:openServers", (event, raw: unknown) => {
    const target = z.enum(["list", "add"]).safeParse(raw);
    if (fromRemote(event) && target.success) showShell(`?${target.data}`);
  });

  const trayIcon = nativeImage.createFromPath(join(__dirname, "assets", isMac ? "trayTemplate.png" : "tray.png"));
  const tray = new Tray(trayIcon);
  tray.setToolTip("Pika Chat");
  if (process.platform === "win32") tray.on("click", toggleWindow);

  const devMenuItems = (): MenuItemConstructorOptions[] =>
    config.developerMode
      ? [
          { type: "separator" },
          { label: t.devTools, click: openDetachedDevTools },
          { label: t.openDesktopLog, click: openDesktopLogFile },
        ]
      : [];

  function rebuildTray() {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: win.isVisible() ? t.hide : t.show, click: () => (win.isVisible() ? win.hide() : showWindow()) },
        { type: "separator" },
        {
          label: t.switchServer,
          submenu: [
            {
              label: t.localName,
              type: "radio",
              checked: remote?.server.id === LOCAL_SERVER_ID,
              click: () => showShell("?connect=local"),
            },
            ...config.servers.map((server) => ({
              label: server.name,
              type: "radio" as const,
              checked: remote?.server.id === server.id,
              click: () => showShell(`?connect=${server.id}`),
            })),
          ],
        },
        {
          label: t.servers,
          click: () => {
            showWindow();
            showShell("?list");
          },
        },
        { label: t.checkForUpdates, click: () => void manualUpdateCheck() },
        ...devMenuItems(),
        { type: "separator" },
        { label: t.quit, click: () => app.quit() },
      ]),
    );
  }

  const onActive = (run: (contents: WebContents) => void) => () => run(activeView().webContents);
  const zoom = (delta: number) =>
    onActive((contents) => contents.setZoomLevel(contents.getZoomLevel() + delta));

  function rebuildAppMenu() {
    const menu: MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: "appMenu" } as const] : []),
      {
        label: t.file,
        submenu: [
          {
            label: t.servers,
            accelerator: "CmdOrCtrl+Shift+L",
            click: () => showShell("?list"),
          },
          { label: t.checkForUpdates, click: () => void manualUpdateCheck() },
          ...(isMac ? [] : [{ type: "separator" } as const, { role: "quit", label: t.quit } as const]),
        ],
      },
      { role: "editMenu" },
      {
        label: t.view,
        submenu: [
          { label: t.reload, accelerator: "CmdOrCtrl+R", click: onActive((contents) => contents.reload()) },
          { type: "separator" },
          { label: t.zoomIn, accelerator: "CmdOrCtrl+Plus", click: zoom(0.5) },
          { label: t.zoomIn, accelerator: "CmdOrCtrl+=", visible: false, click: zoom(0.5) },
          { label: t.zoomOut, accelerator: "CmdOrCtrl+-", click: zoom(-0.5) },
          { label: t.resetZoom, accelerator: "CmdOrCtrl+0", click: onActive((contents) => contents.setZoomLevel(0)) },
          ...devMenuItems(),
        ],
      },
      { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  }
  rebuildAppMenu();

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void localServer.shutdown().finally(() => app.quit());
  });
  win.on("close", (event) => {
    config.windowState = { bounds: win.getNormalBounds(), isMaximized: win.isMaximized() };
    saveConfig(config);
    if (quitting) return;
    event.preventDefault();
    if (isMac || config.closeAction === "tray") {
      win.hide();
    } else {
      app.quit();
    }
  });
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);

  if (!applyHotkey(config.hotkey)) {
    logDesktop("warn", `could not register global shortcut ${String(config.hotkey)}`);
  }
  showShell("");
  void checkForUpdates(false);
}
