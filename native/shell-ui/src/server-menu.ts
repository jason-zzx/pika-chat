import type { PikaShell, ServerMenuData } from "./host";
import { t } from "./i18n";
import { applyThemeVars } from "./titlebar";

const SVG_NS = "http://www.w3.org/2000/svg";

function iconSvg(pathD: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

export async function mountServerMenu(host: PikaShell) {
  const menuApi = host.desktop?.serverMenu;
  if (!menuApi) return;

  document.documentElement.classList.add("chrome-transparent");
  document.body.className = "chrome-transparent";

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  const panel = document.createElement("div");
  panel.className = "server-menu";
  panel.setAttribute("role", "menu");
  panel.hidden = true;
  backdrop.append(panel);
  document.body.replaceChildren(backdrop);

  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) menuApi.close();
  });

  let currentData: ServerMenuData | null = null;

  const positionPanel = () => {
    if (!currentData || panel.hidden || window.innerWidth === 0 || window.innerHeight === 0) return;
    panel.style.left = "0px";
    panel.style.top = "0px";

    const rect = panel.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(pad, Math.min(currentData.anchor.x, window.innerWidth - rect.width - pad));
    const belowY = currentData.anchor.y + 4;
    const y =
      belowY + rect.height <= window.innerHeight - pad
        ? belowY
        : Math.max(pad, window.innerHeight - rect.height - pad);
    panel.style.left = `${Math.round(x)}px`;
    panel.style.top = `${Math.round(y)}px`;
  };

  window.addEventListener("resize", positionPanel);

  const renderMenu = (data: ServerMenuData | null) => {
    currentData = data;
    if (!data) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    applyThemeVars(data.theme);

    const items: HTMLButtonElement[] = [];
    const makeItem = (
      label: string,
      onClick: () => void,
      options: { leftIcon?: string; radio?: boolean; checked?: boolean } = {},
    ) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "server-menu-item";
      if (options.radio) {
        btn.setAttribute("role", "menuitemradio");
        btn.setAttribute("aria-checked", options.checked ? "true" : "false");
      } else {
        btn.setAttribute("role", "menuitem");
      }
      if (options.leftIcon) btn.append(iconSvg(options.leftIcon, "server-menu-icon"));
      const text = document.createElement("span");
      text.className = "server-menu-label";
      text.textContent = label;
      btn.append(text);
      if (options.checked) btn.append(iconSvg("M3.5 8.5l3 3 6-6.5", "server-menu-check"));
      btn.onclick = onClick;
      items.push(btn);
      return btn;
    };

    const children: HTMLElement[] = [
      makeItem(data.localName, () => menuApi.select("local"), {
        radio: true,
        checked: data.activeServerId === "local",
      }),
      ...data.servers.map((server) =>
        makeItem(server.name, () => menuApi.select(server.id), {
          radio: true,
          checked: server.id === data.activeServerId,
        }),
      ),
    ];

    const sep = document.createElement("div");
    sep.className = "server-menu-sep";
    sep.setAttribute("role", "separator");
    children.push(sep);

    children.push(
      makeItem(t("addServerMenu"), () => menuApi.open("add"), { leftIcon: "M8 3.25v9.5M3.25 8h9.5" }),
      makeItem(t("manageServersMenu"), () => menuApi.open("list"), {
        leftIcon: "M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5",
      }),
    );

    panel.hidden = false;
    panel.replaceChildren(...children);
    positionPanel();
    requestAnimationFrame(positionPanel);

    (items.find((btn) => btn.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  };

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      menuApi.close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>(".server-menu-item"));
    if (buttons.length === 0) return;
    event.preventDefault();
    const active = document.activeElement;
    const index = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % buttons.length
        : index <= 0
          ? buttons.length - 1
          : index - 1;
    buttons[next]?.focus();
  });

  renderMenu(await menuApi.getData());
  menuApi.onData(renderMenu);
}
