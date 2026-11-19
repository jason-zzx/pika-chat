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
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Server } from "@pika/shell-ui/host";
import { classifyHealth, normalizeServerUrl } from "@pika/shell-ui/servers";
import { loadStrings } from "./i18n";
import { createLocalServer, localPaths } from "./local-server";
import { loadConfig, saveConfig } from "./store";
import { createUpdater } from "./updater";

const LOCAL_SERVER_ID = "local";

const APP_ID = "io.github.jason-zzx.pika-chat";
const isMac = process.platform === "darwin";
const downloadsDir = join(tmpdir(), "pika-chat");

const notifyInput = z.object({
  title: z.string().max(200),
  body: z.string().max(500),
  path: z.string().startsWith("/").max(2048),
});

const anchorInput = z.object({ x: z.number().finite(), y: z.number().finite() });

// Downloaded files with these extensions open in the OS default app; anything else (scripts, code,
// executables, which Windows would run on open) is revealed in the file manager instead.
const OPENABLE_EXTENSIONS = new Set(
  (
    "pdf png jpg jpeg gif webp bmp avif heic mp3 wav ogg oga m4a flac aac opus mp4 webm mov mkv m4v " +
    "docx xlsx pptx odt ods odp epub txt md csv tsv log"
  ).split(" "),
);

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
  const config = loadConfig();
  const t = loadStrings(app.getLocale());
  const localServer = createLocalServer();
  const icon = nativeImage.createFromPath(join(__dirname, "assets", "icon.png"));
  const shellUrl = pathToFileURL(join(__dirname, "shell-ui", "index.html")).href;

  rmSync(downloadsDir, { recursive: true, force: true });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

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
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#fafafa",
  });
  if (restorable && saved.isMaximized) win.maximize();

  // contextIsolation and sandbox are on and nodeIntegration off by Electron's defaults.
  const webPreferences = (preload: string) => ({ preload: join(__dirname, preload) });

  const shellView = new WebContentsView({ webPreferences: webPreferences("preload-shell.js") });
  shellView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  shellView.webContents.on("will-navigate", (event) => event.preventDefault());

  let remote: { view: WebContentsView; server: Server } | null = null;
  const activeView = () => remote?.view ?? shellView;

  const attach = (view: WebContentsView) => {
    for (const child of win.contentView.children) win.contentView.removeChildView(child);
    win.contentView.addChildView(view);
    layout();
    view.webContents.focus();
  };
  const layout = () => {
    const [width, height] = win.getContentSize();
    activeView().setBounds({ x: 0, y: 0, width: width ?? 0, height: height ?? 0 });
  };
  win.on("resize", layout);
  // Focusing the window focuses the BrowserWindow's own empty webContents, not the attached view:
  // the page would report document.hasFocus() false (and notify about replies) while in front.
  // backgroundThrottling: false also keeps visibilityState "visible", so focus is the only signal.
  win.on("focus", () => activeView().webContents.focus());

  const showWindow = () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  const toggleWindow = () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow());

  const closeRemote = () => {
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
    contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) setImmediate(() => showShell(`?failed=${server.id}`));
    });
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
    remote = { view, server };
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
    return accelerator === null || globalShortcut.register(accelerator, toggleWindow);
  };

  const checkForUpdates = createUpdater(t);
  const manualUpdateCheck = () => {
    showWindow();
    void checkForUpdates(true);
  };

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
  handleShell("shell:getHotkey", z.undefined(), () => config.hotkey);
  handleShell("shell:setHotkey", z.string().nullable(), (accelerator) => {
    const ok = applyHotkey(accelerator);
    if (ok) {
      config.hotkey = accelerator;
      saveConfig(config);
    } else applyHotkey(config.hotkey);
    return { ok };
  });
  handleShell("shell:checkForUpdates", z.undefined(), manualUpdateCheck);

  const fromRemote = (event: IpcMainEvent) =>
    remote !== null && event.sender === remote.view.webContents && event.senderFrame?.origin === remote.server.url;

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

  ipcMain.on("native:showServerMenu", (event, raw: unknown) => {
    const anchor = anchorInput.safeParse(raw);
    if (!remote || !fromRemote(event) || !anchor.success) return;
    const current = remote.server.id;
    // The anchor is in viewport CSS px; popup takes window DIP, and the view fills the content area.
    const zoom = event.sender.getZoomFactor();
    Menu.buildFromTemplate([
      {
        label: t.localName,
        type: "radio",
        checked: current === LOCAL_SERVER_ID,
        click: () => current !== LOCAL_SERVER_ID && showShell("?connect=local"),
      },
      ...config.servers.map(
        (server): MenuItemConstructorOptions => ({
          label: server.name,
          type: "radio",
          checked: server.id === current,
          click: () => server.id !== current && showShell(`?connect=${server.id}`),
        }),
      ),
      { type: "separator" },
      { label: t.addServer, click: () => showShell("?add") },
      { label: t.manageServers, click: () => showShell("?list") },
    ]).popup({ window: win, x: Math.round(anchor.data.x * zoom), y: Math.round(anchor.data.y * zoom) });
  });
  ipcMain.on("native:openServers", (event, raw: unknown) => {
    const target = z.enum(["list", "add"]).safeParse(raw);
    if (fromRemote(event) && target.success) showShell(`?${target.data}`);
  });

  const trayIcon = nativeImage.createFromPath(join(__dirname, "assets", isMac ? "trayTemplate.png" : "tray.png"));
  const tray = new Tray(trayIcon);
  tray.setToolTip("Pika Chat");
  if (process.platform === "win32") tray.on("click", toggleWindow);

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
        { label: t.checkForUpdates, click: manualUpdateCheck },
        { type: "separator" },
        { label: t.quit, click: () => app.quit() },
      ]),
    );
  }
  win.on("show", rebuildTray);
  win.on("hide", rebuildTray);

  const onActive = (run: (contents: WebContents) => void) => () => run(activeView().webContents);
  const zoom = (delta: number) =>
    onActive((contents) => contents.setZoomLevel(contents.getZoomLevel() + delta));
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
        { label: t.checkForUpdates, click: manualUpdateCheck },
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
        { type: "separator" },
        { label: t.devTools, accelerator: "CmdOrCtrl+Alt+I", click: onActive((contents) => contents.toggleDevTools()) },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));

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
    win.hide();
  });
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);

  if (!applyHotkey(config.hotkey)) console.error("could not register global shortcut", config.hotkey);
  showShell("");
  void checkForUpdates(false);
}
