import "./style.css";
import type { DesktopThemeColors, PikaShell, Server } from "./host";
import { mountServerMenu } from "./server-menu";
import { t } from "./i18n";
import { normalizeServerUrl, sameMajorMinor } from "./servers";
import { mountTitlebar } from "./titlebar";

const host: PikaShell = window.pikaShell;
document.documentElement.lang = navigator.language;

const params = new URLSearchParams(location.search);
const chrome = params.get("chrome");

if (chrome === "titlebar") {
  await mountTitlebar(host);
} else if (chrome === "menu") {
  await mountServerMenu(host);
} else {
  await mountShellPages();
}

function readShellTheme(): DesktopThemeColors {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const probe = document.createElement("div");
  const vars = ["--background", "--foreground", "--muted-foreground", "--popover", "--popover-foreground", "--accent", "--accent-foreground", "--border"] as const;
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", {
    willReadFrequently: true,
  });
  const toCss = (css: string, fallback: string, opaque = false) => {
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#00000000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const r = d[0] ?? 0;
    const g = d[1] ?? 0;
    const b = d[2] ?? 0;
    const a = d[3] ?? 0;
    if (a === 0) return fallback;
    if (a === 255 || opaque) return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  };
  const bodyStyle = getComputedStyle(document.body);
  probe.style.display = "none";
  document.body.append(probe);
  const resolved: Record<string, string> = {};
  for (const name of vars) {
    if (!bodyStyle.getPropertyValue(name).trim()) {
      resolved[name] = "";
      continue;
    }
    probe.style.color = `var(${name})`;
    resolved[name] = getComputedStyle(probe).color;
  }
  probe.remove();
  const fallbackBg = isDark ? "#0a0a0a" : "#fafafa";
  const fallbackFg = isDark ? "#fafafa" : "#0a0a0a";
  return {
    isDark,
    background: toCss(resolved["--background"] ?? "", fallbackBg, true),
    foreground: toCss(resolved["--foreground"] ?? "", fallbackFg),
    mutedForeground: toCss(resolved["--muted-foreground"] ?? "", isDark ? "#a3a3a3" : "#737373"),
    popover: toCss(resolved["--popover"] ?? "", isDark ? "#171717" : "#ffffff", true),
    popoverForeground: toCss(resolved["--popover-foreground"] ?? "", fallbackFg),
    accent: toCss(resolved["--accent"] ?? "", isDark ? "#262626" : "#f5f5f5"),
    accentForeground: toCss(resolved["--accent-foreground"] ?? "", fallbackFg),
    border: toCss(resolved["--border"] ?? "", isDark ? "rgba(255, 255, 255, 0.1)" : "#e5e5e5"),
  };
}

async function mountShellPages() {
  if (host.desktop) {
    const syncShellTheme = () => host.desktop?.setTheme(readShellTheme());
    syncShellTheme();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncShellTheme);
  }

  type Child = Node | string;

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    ...children: Child[]
  ): HTMLElementTagNameMap[K] {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function button(
    label: string,
    onclick: () => void,
    variant: "primary" | "secondary" | "ghost" | "destructive" = "secondary",
    focus = false,
  ) {
    const node = el("button", { type: "button", className: `btn btn-${variant}`, textContent: label, onclick });
    if (focus) node.dataset.focus = "";
    return node;
  }

  function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = el(
        "dialog",
        {
          className: "confirm-dialog",
          onclose: () => {
            dialog.remove();
            resolve(dialog.returnValue === "confirm");
          },
          onclick: (event) => {
            if (event.target === dialog) dialog.close();
          },
        },
        el("h2", { textContent: title }),
        el("p", { className: "muted", textContent: body }),
        el(
          "div",
          { className: "actions end" },
          button(t("cancel"), () => dialog.close(), "secondary"),
          button(confirmLabel, () => dialog.close("confirm"), "destructive", true),
        ),
      );
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  function render(...children: Child[]) {
    const view = el("main", { className: "view" }, ...children);
    document.body.replaceChildren(view);
    view.querySelector<HTMLElement>("[data-focus]")?.focus();
  }

  function heading(title: string, body?: string) {
    return el(
      "header",
      { className: "heading" },
      el("h1", { textContent: title }),
      ...(body ? [el("p", { className: "muted", textContent: body })] : []),
    );
  }

  let navigation = 0;
  const LOCAL_SERVER_ID = "local";

  function desktopFooter(developerMode: boolean): HTMLElement | null {
    const desktop = host.desktop;
    if (!desktop) return null;

    let enabled = developerMode;
    let clicks = 0;
    let timer: number | undefined;
    const footer = el("footer", { className: "shell-footer" });
    const hint = el("span", { className: "footer-hint" });
    const versionBtn = el("button", {
      type: "button",
      className: "version-trigger",
      textContent: `v${host.appVersion}`,
    });

    const paint = () => {
      const extras = enabled
        ? [
            button(t("openDevTools"), () => void desktop.openDevTools(), "ghost"),
            button(t("openDesktopLog"), () => void desktop.openDesktopLog(), "ghost"),
          ]
        : [];
      footer.replaceChildren(versionBtn, hint, ...extras);
    };

    versionBtn.onclick = async () => {
      if (enabled) return;
      window.clearTimeout(timer);
      clicks += 1;
      timer = window.setTimeout(() => {
        clicks = 0;
        hint.textContent = "";
      }, 1500);

      if (clicks >= 5) {
        clicks = 0;
        window.clearTimeout(timer);
        await desktop.setDeveloperMode(true);
        enabled = true;
        hint.textContent = t("developerModeEnabled");
        paint();
        return;
      }
      if (clicks >= 3) {
        hint.textContent = t("developerModeClicks", { count: String(5 - clicks) });
      }
    };

    paint();
    return footer;
  }

  async function showList() {
    navigation++;
    const [{ servers }, devMode] = await Promise.all([
      host.listServers(),
      host.desktop ? host.desktop.getDeveloperMode() : Promise.resolve(false),
    ]);
    const rows: HTMLLIElement[] = [];
    if (host.desktop) {
      const local = el(
        "button",
        { type: "button", className: "row-main", onclick: () => void connectLocal() },
        el("span", { className: "row-name", textContent: t("localName") }),
        el("span", { className: "row-url muted", textContent: t("localDescription") }),
      );
      rows.push(el("li", { className: "row" }, local));
    }
    rows.push(
      ...servers.map((server) => {
        const rowButton = el(
          "button",
          { type: "button", className: "row-main", onclick: () => void connect(server) },
          el("span", { className: "row-name", textContent: server.name }),
          el("span", { className: "row-url muted", textContent: server.url }),
        );
        const removeButton = button(
          t("remove"),
          async () => {
            if (!(await confirmDialog(t("removeTitle", { name: server.name }), t("removeBody"), t("remove")))) {
              return;
            }
            await host.removeServer(server.id);
            await showList();
          },
          "ghost",
        );
        removeButton.classList.add("btn-remove");
        return el(
          "li",
          { className: "row" },
          rowButton,
          el("div", { className: "row-actions" }, button(t("edit"), () => showForm(server), "ghost"), removeButton),
        );
      }),
    );

    const toolbarActions = host.desktop
      ? [button(t("addServer"), () => showForm(), "primary")]
      : [button(t("settings"), () => void showMobileSettings(), "ghost"), button(t("addServer"), () => showForm(), "primary")];
    const footer = desktopFooter(devMode);

    render(
      el("div", { className: "toolbar" }, el("h1", { textContent: t("servers") }), el("div", { className: "actions" }, ...toolbarActions)),
      el("ul", { className: "list" }, ...rows),
      ...(footer ? [footer] : []),
    );
  }

  function showWelcome() {
    navigation++;
    render(
      heading(t("welcomeTitle"), t("welcomeBody")),
      el(
        "div",
        { className: "actions" },
        button(t("useLocal"), () => void connectLocal(), "primary", true),
        button(t("connectRemote"), () => showForm()),
      ),
    );
  }

  async function connectLocal() {
    const run = ++navigation;
    render(
      el(
        "div",
        { className: "status" },
        el("div", { className: "spinner", role: "progressbar" }),
        el("p", { textContent: t("localStarting") }),
        button(t("cancel"), () => void showList(), "ghost", true),
      ),
    );
    try {
      await host.connect(LOCAL_SERVER_ID);
    } catch {
      if (run !== navigation) return;
      await showLocalError();
    }
  }

  async function showLocalError() {
    const desktop = host.desktop;
    if (!desktop) return showList();
    navigation++;
    const detail = await desktop.getLocalError();
    render(
      heading(t("localFailedTitle"), detail ?? t("localFailedBody")),
      el(
        "div",
        { className: "actions" },
        button(t("retry"), () => void connectLocal(), "primary", true),
        button(t("openLog"), () => void desktop.openLocalLog()),
        button(t("back"), () => void showList()),
      ),
    );
  }

  function showForm(server?: Server, allowCancel = true) {
    navigation++;
    let warned = false;
    const nameInput = el("input", { id: "name", value: server?.name ?? "", autocomplete: "off" });
    const urlInput = el("input", {
      id: "url",
      value: server?.url ?? "",
      placeholder: t("urlPlaceholder"),
      autocomplete: "off",
      spellcheck: false,
      inputMode: "url",
    });
    urlInput.dataset.focus = "";
    const message = el("p", { className: "message", role: "alert" });
    const submit = el("button", { type: "submit", className: "btn btn-primary", textContent: t("save") });

    const reset = () => {
      warned = false;
      message.textContent = "";
      submit.textContent = t("save");
    };
    nameInput.oninput = reset;
    urlInput.oninput = reset;

    const form = el(
      "form",
      { className: "form" },
      el("label", { htmlFor: "url", textContent: t("url") }),
      urlInput,
      el("label", { htmlFor: "name" }, t("name"), el("span", { className: "muted", textContent: ` · ${t("nameHint")}` })),
      nameInput,
      message,
      el("div", { className: "actions end" }, ...(allowCancel ? [button(t("cancel"), () => void showList())] : []), submit),
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      const url = normalizeServerUrl(urlInput.value);
      if (!url) {
        message.textContent = t("invalidUrl");
        return;
      }
      if (!warned) {
        submit.disabled = true;
        const check = await host.checkServer(url);
        submit.disabled = false;
        if (!check.ok) {
          warned = true;
          message.textContent = check.reason === "unreachable" ? t("unreachableTitle") : t("notPikaTitle");
          submit.textContent = t("saveAnyway");
          return;
        }
      }
      await host.saveServer({ id: server?.id, name: nameInput.value, url });
      await showList();
    };
    render(heading(server ? t("editServer") : t("addServer")), form);
  }

  async function connect(server: Server, { skipVersionCheck = false } = {}) {
    const run = ++navigation;
    render(
      el(
        "div",
        { className: "status" },
        el("div", { className: "spinner", role: "progressbar" }),
        el("p", { textContent: t("connecting", { name: server.name }) }),
        button(t("cancel"), () => void showList(), "ghost", true),
      ),
    );
    const check = await host.checkServer(server.url);
    if (run !== navigation) return;
    if (!check.ok) {
      showError(server, check.reason);
      return;
    }
    if (!skipVersionCheck && !sameMajorMinor(check.version, host.appVersion)) {
      render(
        heading(
          t("versionTitle"),
          t("versionBody", { server: check.version ?? t("olderServer"), app: host.appVersion }),
        ),
        el(
          "div",
          { className: "actions" },
          button(t("connectAnyway"), () => void connect(server, { skipVersionCheck: true }), "primary", true),
          button(t("back"), () => void showList()),
        ),
      );
      return;
    }
    try {
      await host.connect(server.id);
    } catch (err) {
      if (run !== navigation) return;
      const message = err instanceof Error ? err.message : undefined;
      showError(server, "unreachable", message);
    }
  }

  function showError(server: Server, reason: "unreachable" | "not-pika", detail?: string) {
    navigation++;
    const unreachable = reason === "unreachable";
    render(
      heading(
        unreachable ? t("unreachableTitle") : t("notPikaTitle"),
        detail || (unreachable ? t("unreachableBody") : t("notPikaBody")),
      ),
      el(
        "div",
        { className: "actions" },
        button(t("retry"), () => void connect(server), "primary", true),
        button(t("back"), () => void showList()),
      ),
    );
  }

  async function showMobileSettings() {
    navigation++;
    const checkUpdatesButton = button(t("checkForUpdates"), async () => {
      checkUpdatesButton.disabled = true;
      checkUpdatesButton.textContent = t("checkingUpdates");
      try {
        await host.checkForUpdates();
      } finally {
        if (checkUpdatesButton.isConnected) {
          checkUpdatesButton.disabled = false;
          checkUpdatesButton.textContent = t("checkForUpdates");
        }
      }
    });
    render(
      el(
        "div",
        { className: "toolbar" },
        el("h1", { textContent: t("settings") }),
        button(t("back"), () => void showList(), "ghost", true),
      ),
      el(
        "section",
        { className: "card" },
        el(
          "div",
          { className: "setting" },
          el("div", {}, el("div", { className: "row-name", textContent: t("version") }), el("div", { className: "muted", textContent: host.appVersion })),
          checkUpdatesButton,
        ),
      ),
    );
  }

  const { servers, lastServerId } = await host.listServers();
  const failedId = params.get("failed");
  const connectId = params.get("connect");
  const failed = servers.find((server) => server.id === failedId);
  const target = servers.find((server) => server.id === connectId);
  const last = servers.find((server) => server.id === lastServerId);
  if (host.desktop && failedId === LOCAL_SERVER_ID) await showLocalError();
  else if (failed) showError(failed, "unreachable");
  else if (host.desktop && connectId === LOCAL_SERVER_ID) await connectLocal();
  else if (target) await connect(target);
  else if (params.has("add")) showForm();
  else if (location.search === "" && host.desktop && lastServerId === LOCAL_SERVER_ID) await connectLocal();
  else if (location.search === "" && last) await connect(last);
  else if (location.search === "" && servers.length === 0) {
    if (host.desktop) showWelcome();
    else showForm(undefined, false);
  } else await showList();
}
