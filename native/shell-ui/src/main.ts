import "./style.css";
import type { DesktopThemeColors, PikaShell, Server } from "./host";
import { t } from "./i18n";
import {
  LOCAL_SERVER_ID,
  canShellGoBack,
  resolveInitialStack,
  stepShellBack,
  type ShellScreen,
} from "./nav-stack";
import { mountServerMenu } from "./server-menu";
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
  const vars = [
    "--background",
    "--foreground",
    "--muted-foreground",
    "--popover",
    "--popover-foreground",
    "--accent",
    "--accent-foreground",
    "--border",
  ] as const;
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

  function arrowLeftIcon(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>';
    return svg;
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

  let navigation = 0;
  let servers: Server[] = [];
  let activeServerId: string | null = null;
  let shellStack: ShellScreen[] = [];
  let activeDialog: HTMLDialogElement | null = null;

  const syncCanGoBack = () => {
    host.setCanGoBack?.(canShellGoBack(shellStack, activeServerId, activeDialog !== null));
  };

  function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = el(
        "dialog",
        {
          className: "confirm-dialog",
          onclose: () => {
            if (activeDialog === dialog) activeDialog = null;
            dialog.remove();
            syncCanGoBack();
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
      activeDialog = dialog;
      document.body.append(dialog);
      dialog.showModal();
      syncCanGoBack();
    });
  }

  function render(...children: Child[]) {
    const view = el("main", { className: "view" }, ...children);
    document.body.replaceChildren(view);
    view.querySelector<HTMLElement>("[data-focus]")?.focus();
    syncCanGoBack();
  }

  function heading(title: string, body?: string) {
    return el(
      "header",
      { className: "heading" },
      el("h1", { textContent: title }),
      ...(body ? [el("p", { className: "muted", textContent: body })] : []),
    );
  }

  const returnToActiveServer = () => {
    navigation++;
    void host.returnToServer();
  };

  const pushAndRender = (screen: ShellScreen) => {
    shellStack = [...shellStack, screen];
    void renderTop();
  };

  const replaceAndRender = (screen: ShellScreen) => {
    shellStack = shellStack.length <= 1 ? [screen] : [...shellStack.slice(0, -1), screen];
    void renderTop();
  };

  const resetAndRender = (screen: ShellScreen) => {
    shellStack = [screen];
    void renderTop();
  };

  const handleBack = () => {
    const outcome = stepShellBack(shellStack, activeServerId, activeDialog !== null);
    if (outcome.action === "closeDialog") {
      activeDialog?.close();
      return;
    }
    if (outcome.action === "pop") {
      shellStack = outcome.stack;
      void renderTop();
      return;
    }
    if (outcome.action === "returnToServer") {
      returnToActiveServer();
    }
  };

  const cancelOrBack = () => {
    if (shellStack.length > 1) {
      handleBack();
      return;
    }
    if (activeServerId !== null) {
      returnToActiveServer();
      return;
    }
    resetAndRender({ kind: "list" });
  };

  host.onBack?.(handleBack);
  window.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing
    ) {
      return;
    }
    if (!canShellGoBack(shellStack, activeServerId, activeDialog !== null)) return;
    event.preventDefault();
    handleBack();
  });

  function shellFooter(developerMode: boolean): HTMLElement {
    const desktop = host.desktop;
    let enabled = developerMode;
    let clicks = 0;
    let timer: number | undefined;
    const footer = el("footer", { className: "shell-footer" });
    const hint = el("span", { className: "footer-hint" });
    const sep = el("span", { className: "footer-sep", textContent: "·" });
    sep.setAttribute("aria-hidden", "true");

    const versionNode = desktop
      ? el("button", {
          type: "button",
          className: "footer-action",
          textContent: `v${host.appVersion}`,
        })
      : el("span", {
          className: "footer-version",
          textContent: `v${host.appVersion}`,
        });

    const checkUpdatesButton = el("button", {
      type: "button",
      className: "footer-action",
      textContent: t("checkForUpdates"),
    });
    checkUpdatesButton.onclick = async () => {
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
    };

    const paint = () => {
      const extras =
        desktop && enabled
          ? [
              button(t("openDevTools"), () => void desktop.openDevTools(), "ghost"),
              button(t("openDesktopLog"), () => void desktop.openDesktopLog(), "ghost"),
            ]
          : [];
      footer.replaceChildren(versionNode, sep, checkUpdatesButton, ...(hint.textContent ? [hint] : []), ...extras);
    };

    if (desktop && versionNode instanceof HTMLButtonElement) {
      versionNode.onclick = async () => {
        if (enabled) return;
        window.clearTimeout(timer);
        clicks += 1;
        timer = window.setTimeout(() => {
          clicks = 0;
          hint.textContent = "";
          paint();
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
          paint();
        }
      };
    }

    paint();
    return footer;
  }

  async function renderList(run: number) {
    const [state, devMode] = await Promise.all([
      host.listServers(),
      host.desktop ? host.desktop.getDeveloperMode() : Promise.resolve(false),
    ]);
    if (run !== navigation) return;
    servers = state.servers;
    activeServerId = state.activeServerId;

    const rows: HTMLLIElement[] = [];
    if (host.desktop) {
      const isActive = activeServerId === LOCAL_SERVER_ID;
      const local = el(
        "button",
        {
          type: "button",
          className: "row-main",
          onclick: () =>
            isActive ? returnToActiveServer() : pushAndRender({ kind: "connecting", serverId: LOCAL_SERVER_ID }),
        },
        el("span", { className: "row-name", textContent: t("localName") }),
        el("span", { className: "row-url muted", textContent: t("localDescription") }),
      );
      if (isActive) local.setAttribute("aria-current", "true");
      rows.push(el("li", { className: isActive ? "row row-active" : "row" }, local));
    }
    rows.push(
      ...servers.map((server) => {
        const isActive = activeServerId === server.id;
        const rowButton = el(
          "button",
          {
            type: "button",
            className: "row-main",
            onclick: () =>
              isActive ? returnToActiveServer() : pushAndRender({ kind: "connecting", serverId: server.id }),
          },
          el("span", { className: "row-name", textContent: server.name }),
          el("span", { className: "row-url muted", textContent: server.url }),
        );
        if (isActive) rowButton.setAttribute("aria-current", "true");
        const removeButton = button(
          t("remove"),
          async () => {
            if (!(await confirmDialog(t("removeTitle", { name: server.name }), t("removeBody"), t("remove")))) {
              return;
            }
            await host.removeServer(server.id);
            if (run !== navigation) return;
            await renderTop();
          },
          "ghost",
        );
        removeButton.classList.add("btn-remove");
        return el(
          "li",
          { className: isActive ? "row row-active" : "row" },
          rowButton,
          el(
            "div",
            { className: "row-actions" },
            button(t("edit"), () => pushAndRender({ kind: "form", server, allowCancel: true }), "ghost"),
            removeButton,
          ),
        );
      }),
    );

    const toolbarStartChildren: Child[] = [];
    if (activeServerId !== null) {
      const returnBtn = el(
        "button",
        {
          type: "button",
          className: "btn btn-ghost btn-return",
          ariaLabel: t("returnToServer"),
          title: t("returnToServer"),
          onclick: returnToActiveServer,
        },
        arrowLeftIcon(),
      );
      toolbarStartChildren.push(returnBtn);
    }
    toolbarStartChildren.push(el("h1", { textContent: t("servers") }));

    const toolbarActions = [button(t("addServer"), () => pushAndRender({ kind: "form", allowCancel: true }), "primary")];

    render(
      el(
        "div",
        { className: "toolbar" },
        el("div", { className: "toolbar-start" }, ...toolbarStartChildren),
        el("div", { className: "actions" }, ...toolbarActions),
      ),
      el("ul", { className: "list" }, ...rows),
      shellFooter(devMode),
    );
  }

  function renderWelcome() {
    render(
      heading(t("welcomeTitle"), t("welcomeBody")),
      el(
        "div",
        { className: "actions" },
        button(t("useLocal"), () => pushAndRender({ kind: "connecting", serverId: LOCAL_SERVER_ID }), "primary", true),
        button(t("connectRemote"), () => pushAndRender({ kind: "form", allowCancel: true })),
      ),
    );
  }

  async function renderConnectingLocal(run: number) {
    render(
      el(
        "div",
        { className: "status" },
        el("div", { className: "spinner", role: "progressbar" }),
        el("p", { textContent: t("localStarting") }),
        button(t("cancel"), cancelOrBack, "ghost", true),
      ),
    );
    try {
      await host.connect(LOCAL_SERVER_ID);
    } catch {
      if (run !== navigation) return;
      replaceAndRender({ kind: "error", serverId: LOCAL_SERVER_ID, reason: "unreachable" });
    }
  }

  async function renderLocalError(run: number) {
    const desktop = host.desktop;
    if (!desktop) {
      resetAndRender({ kind: "list" });
      return;
    }
    const detail = await desktop.getLocalError();
    if (run !== navigation) return;
    render(
      heading(t("localFailedTitle"), detail ?? t("localFailedBody")),
      el(
        "div",
        { className: "actions" },
        button(
          t("retry"),
          () => replaceAndRender({ kind: "connecting", serverId: LOCAL_SERVER_ID }),
          "primary",
          true,
        ),
        button(t("openLog"), () => void desktop.openLocalLog()),
        button(t("back"), () => resetAndRender({ kind: "list" })),
      ),
    );
  }

  function renderForm(run: number, server?: Server, allowCancel = true) {
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
      el("div", { className: "actions end" }, ...(allowCancel ? [button(t("cancel"), cancelOrBack)] : []), submit),
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
        if (run !== navigation) return;
        submit.disabled = false;
        if (!check.ok) {
          warned = true;
          message.textContent = check.reason === "unreachable" ? t("unreachableTitle") : t("notPikaTitle");
          submit.textContent = t("saveAnyway");
          return;
        }
      }
      await host.saveServer({ id: server?.id, name: nameInput.value, url });
      if (run !== navigation) return;
      resetAndRender({ kind: "list" });
    };
    render(heading(server ? t("editServer") : t("addServer")), form);
  }

  async function renderConnectingRemote(run: number, server: Server, skipVersionCheck: boolean) {
    render(
      el(
        "div",
        { className: "status" },
        el("div", { className: "spinner", role: "progressbar" }),
        el("p", { textContent: t("connecting", { name: server.name }) }),
        button(t("cancel"), cancelOrBack, "ghost", true),
      ),
    );
    const check = await host.checkServer(server.url);
    if (run !== navigation) return;
    if (!check.ok) {
      replaceAndRender({ kind: "error", serverId: server.id, reason: check.reason });
      return;
    }
    if (!skipVersionCheck && !sameMajorMinor(check.version, host.appVersion)) {
      replaceAndRender({ kind: "versionWarning", server, serverVersion: check.version });
      return;
    }
    try {
      await host.connect(server.id);
    } catch (err) {
      if (run !== navigation) return;
      const detail = err instanceof Error ? err.message : undefined;
      replaceAndRender({ kind: "error", serverId: server.id, reason: "unreachable", detail });
    }
  }

  function renderVersionWarning(server: Server, serverVersion: string | null) {
    render(
      heading(
        t("versionTitle"),
        t("versionBody", { server: serverVersion ?? t("olderServer"), app: host.appVersion }),
      ),
      el(
        "div",
        { className: "actions" },
        button(
          t("connectAnyway"),
          () => replaceAndRender({ kind: "connecting", serverId: server.id, skipVersionCheck: true }),
          "primary",
          true,
        ),
        button(t("back"), () => resetAndRender({ kind: "list" })),
      ),
    );
  }

  function renderRemoteError(server: Server, reason: "unreachable" | "not-pika", detail?: string) {
    const unreachable = reason === "unreachable";
    render(
      heading(
        unreachable ? t("unreachableTitle") : t("notPikaTitle"),
        detail || (unreachable ? t("unreachableBody") : t("notPikaBody")),
      ),
      el(
        "div",
        { className: "actions" },
        button(t("retry"), () => replaceAndRender({ kind: "connecting", serverId: server.id }), "primary", true),
        button(t("back"), () => resetAndRender({ kind: "list" })),
      ),
    );
  }

  async function renderTop() {
    const run = ++navigation;
    const screen = shellStack[shellStack.length - 1];
    if (!screen) return;
    if (screen.kind === "list") {
      await renderList(run);
      return;
    }
    if (screen.kind === "welcome") {
      renderWelcome();
      return;
    }
    if (screen.kind === "form") {
      renderForm(run, screen.server, screen.allowCancel);
      return;
    }
    if (screen.kind === "versionWarning") {
      renderVersionWarning(screen.server, screen.serverVersion);
      return;
    }
    if (screen.kind === "connecting") {
      if (host.desktop && screen.serverId === LOCAL_SERVER_ID) {
        await renderConnectingLocal(run);
        return;
      }
      const target = servers.find((s) => s.id === screen.serverId);
      if (!target) {
        resetAndRender({ kind: "list" });
        return;
      }
      await renderConnectingRemote(run, target, screen.skipVersionCheck ?? false);
      return;
    }
    if (host.desktop && screen.serverId === LOCAL_SERVER_ID) {
      await renderLocalError(run);
      return;
    }
    const target = servers.find((s) => s.id === screen.serverId);
    if (!target) {
      resetAndRender({ kind: "list" });
      return;
    }
    renderRemoteError(target, screen.reason, screen.detail);
  }

  const initial = await host.listServers();
  servers = initial.servers;
  activeServerId = initial.activeServerId;
  shellStack = resolveInitialStack({
    search: location.search,
    servers: initial.servers,
    lastServerId: initial.lastServerId,
    hasDesktop: Boolean(host.desktop),
  });
  syncCanGoBack();
  await renderTop();
}
