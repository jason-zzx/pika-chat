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

async function showList() {
  navigation++;
  const { servers } = await host.listServers();
  const rows = servers.map((server) =>
    el(
      "li",
      { className: "row" },
      el(
        "button",
        { type: "button", className: "row-main", onclick: () => void connect(server) },
        el("span", { className: "row-name", textContent: server.name }),
        el("span", { className: "row-url muted", textContent: server.url }),
      ),
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
    ),
  );
  const first = rows[0]?.querySelector<HTMLElement>(".row-main");
  if (first) first.dataset.focus = "";
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
    rows.length > 0
      ? el("ul", { className: "list" }, ...rows)
      : el(
          "div",
          { className: "empty" },
          el("p", { className: "empty-title", textContent: t("noServers") }),
          el("p", { className: "muted", textContent: t("noServersHint") }),
        ),
  );
}

function showForm(server?: Server) {
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
    el("div", { className: "actions end" }, button(t("cancel"), () => void showList()), submit),
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
  await host.connect(server.id);
}

function showError(server: Server, reason: "unreachable" | "not-pika") {
  navigation++;
  const unreachable = reason === "unreachable";
  render(
    heading(unreachable ? t("unreachableTitle") : t("notPikaTitle"), unreachable ? t("unreachableBody") : t("notPikaBody")),
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
  let hotkey = await host.getHotkey();
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
    const result = await host.setHotkey(accelerator);
    message.textContent = result.ok ? "" : t("hotkeyFailed");
    if (result.ok) hotkey = accelerator;
    idle();
  };

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
              await host.setHotkey(null);
              hotkey = null;
              message.textContent = "";
              idle();
            },
            "ghost",
          ),
        ),
      ),
      message,
      el(
        "div",
        { className: "setting" },
        el("div", {}, el("div", { className: "row-name", textContent: t("version") }), el("div", { className: "muted", textContent: host.appVersion })),
        button(t("checkForUpdates"), () => void host.checkForUpdates()),
      ),
    ),
  );
}

const params = new URLSearchParams(location.search);
const { servers, lastServerId } = await host.listServers();
const failed = servers.find((server) => server.id === params.get("failed"));
const target = servers.find((server) => server.id === params.get("connect"));
const last = servers.find((server) => server.id === lastServerId);
if (failed) showError(failed, "unreachable");
else if (target) await connect(target);
else if (params.has("add")) showForm();
else if (last && location.search === "") await connect(last);
else await showList();
