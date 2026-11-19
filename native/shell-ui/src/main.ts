import "./style.css";
import type { PikaShell, Server } from "./host";
import { t } from "./i18n";
import { acceleratorFromKey, normalizeServerUrl, sameMajorMinor } from "./servers";

const host: PikaShell = window.pikaShell;
const isMac = navigator.userAgent.includes("Mac");
document.documentElement.lang = navigator.language;

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
  variant: "primary" | "secondary" | "ghost" = "secondary",
  focus = false,
) {
  const node = el("button", { type: "button", className: `btn btn-${variant}`, textContent: label, onclick });
  if (focus) node.dataset.focus = "";
  return node;
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

async function showList() {
  navigation++;
  const { servers } = await host.listServers();
  const rows: HTMLLIElement[] = [];
  if (host.desktop) {
    const local = el(
      "button",
      { type: "button", className: "row-main", onclick: () => void connectLocal() },
      el("span", { className: "row-name", textContent: t("localName") }),
      el("span", { className: "row-url muted", textContent: t("localDescription") }),
    );
    local.dataset.focus = "";
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
      return el(
        "li",
        { className: "row" },
        rowButton,
        button(t("edit"), () => showForm(server), "ghost"),
        button(
          t("remove"),
          async () => {
            if (!confirm(t("removeConfirm", { name: server.name }))) return;
            await host.removeServer(server.id);
            await showList();
          },
          "ghost",
        ),
      );
    }),
  );
  render(
    el(
      "div",
      { className: "toolbar" },
      el("h1", { textContent: t("servers") }),
      el(
        "div",
        { className: "actions" },
        button(t("settings"), () => void showSettings(), "ghost"),
        button(t("addServer"), () => showForm(), "primary"),
      ),
    ),
    el("ul", { className: "list" }, ...rows),
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

async function showSettings() {
  navigation++;
  const desktop = host.desktop;
  const rows: Child[] = [];
  if (desktop) {
    let hotkey = await desktop.getHotkey();
    const message = el("p", { className: "message", role: "alert" });
    const recorder = el("button", { type: "button", className: "btn btn-secondary recorder" });
    const label = (accelerator: string | null) =>
      accelerator === null ? t("hotkeyNone") : accelerator.replace("CommandOrControl", isMac ? "Cmd" : "Ctrl");

    let recording = false;
    const idle = () => {
      recording = false;
      recorder.textContent = label(hotkey);
      recorder.title = t("hotkeyRecord");
    };
    idle();
    recorder.onclick = () => {
      recording = true;
      recorder.textContent = t("hotkeyRecording");
    };
    recorder.onblur = idle;
    recorder.onkeydown = async (event) => {
      if (!recording) return;
      event.preventDefault();
      if (event.code === "Escape") {
        idle();
        return;
      }
      const accelerator = acceleratorFromKey(event, isMac);
      if (!accelerator) return;
      const result = await desktop.setHotkey(accelerator);
      message.textContent = result.ok ? "" : t("hotkeyFailed");
      if (result.ok) hotkey = accelerator;
      idle();
    };

    rows.push(
      el(
        "div",
        { className: "setting" },
        el(
          "div",
          {},
          el("div", { className: "row-name", textContent: t("hotkey") }),
          el("div", { className: "muted", textContent: t("hotkeyHint") }),
        ),
        el(
          "div",
          { className: "actions" },
          recorder,
          button(
            t("hotkeyClear"),
            async () => {
              await desktop.setHotkey(null);
              hotkey = null;
              message.textContent = "";
              idle();
            },
            "ghost",
          ),
        ),
      ),
      message,
    );
  }
  rows.push(
    el(
      "div",
      { className: "setting" },
      el("div", {}, el("div", { className: "row-name", textContent: t("version") }), el("div", { className: "muted", textContent: host.appVersion })),
      button(t("checkForUpdates"), () => void host.checkForUpdates()),
    ),
  );

  render(
    el(
      "div",
      { className: "toolbar" },
      el("h1", { textContent: t("settings") }),
      button(t("back"), () => void showList(), "ghost", true),
    ),
    el("section", { className: "card" }, ...rows),
  );
}

const params = new URLSearchParams(location.search);
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
// Nothing to auto-connect to and no saved servers: offer the first-run choice (welcome on desktop, add form on mobile).
else if (location.search === "" && servers.length === 0) {
  if (host.desktop) showWelcome();
  else showForm(undefined, false);
} else await showList();
