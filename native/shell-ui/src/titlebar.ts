import type { DesktopThemeColors, PikaShell, TitlebarState } from "./host";
import { t } from "./i18n";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(viewBox: string, width: string, height: string, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  return svg;
}

function createPikaIcon(): SVGSVGElement {
  const svg = svgEl("0 0 32 32", "16", "16", "titlebar-icon");
  svg.innerHTML =
    '<g fill="#F6E4C8"><circle cx="10.4" cy="8.2" r="5.15"/><circle cx="21.6" cy="8.2" r="5.15"/><rect x="4.6" y="10.4" width="22.8" height="14.6" rx="7.3"/><path d="M9.2 22.8C6.4 25.6 4.15 28.7 4.2 30.55c.02.55.62.88 1.1.62 1.95-1.05 3.85-2.7 5.55-4.35.5-.48.58-1.25.18-1.78L10.3 23.2c-.28-.38-.78-.4-1.1-.4z"/></g><circle cx="10.4" cy="7.55" r="2.35" fill="#C97B56"/><circle cx="21.6" cy="7.55" r="2.35" fill="#C97B56"/><circle cx="12.15" cy="16.6" r="1.55" fill="#35564A"/><circle cx="19.85" cy="16.6" r="1.55" fill="#35564A"/>';
  return svg;
}

function controlSvg(paths: Array<{ tag: "path" | "rect"; attrs: Record<string, string> }>): SVGSVGElement {
  const svg = svgEl("0 0 12 12", "11", "11");
  for (const item of paths) {
    const node = document.createElementNS(SVG_NS, item.tag);
    for (const [k, v] of Object.entries(item.attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

export function applyThemeVars(theme: DesktopThemeColors) {
  const root = document.documentElement.style;
  root.colorScheme = theme.isDark ? "dark" : "light";
  root.setProperty("--background", theme.background);
  root.setProperty("--foreground", theme.foreground);
  root.setProperty("--muted-foreground", theme.mutedForeground);
  root.setProperty("--popover", theme.popover);
  root.setProperty("--popover-foreground", theme.popoverForeground);
  root.setProperty("--accent", theme.accent);
  root.setProperty("--accent-foreground", theme.accentForeground);
  root.setProperty("--border", theme.border);
  root.setProperty("--titlebar-background", theme.titlebarBackground ?? theme.background);
  root.setProperty("--titlebar-border", theme.titlebarBorderless ? "transparent" : theme.border);
  root.setProperty("--menu-background", theme.isDark ? theme.popover : theme.background);
  root.setProperty("--menu-foreground", theme.isDark ? theme.popoverForeground : theme.foreground);
}

export async function mountTitlebar(host: PikaShell) {
  const controls = host.desktop?.windowControls;
  if (!controls) return;
  document.body.className = "chrome-titlebar";

  const bar = document.createElement("header");
  bar.className = "titlebar";

  const brand = document.createElement("div");
  brand.className = "titlebar-brand";
  const titleSpan = document.createElement("span");
  titleSpan.className = "titlebar-title";
  brand.append(createPikaIcon(), titleSpan);
  bar.append(brand);

  const buttons = document.createElement("div");
  buttons.className = "titlebar-controls";

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "titlebar-btn";
  minBtn.ariaLabel = t("minimize");
  minBtn.append(controlSvg([{ tag: "path", attrs: { d: "M2 6h8", stroke: "currentColor", "stroke-width": "1.2" } }]));
  minBtn.onclick = () => controls.minimize();

  const maxBtn = document.createElement("button");
  maxBtn.type = "button";
  maxBtn.className = "titlebar-btn";
  maxBtn.onclick = () => controls.toggleMaximize();

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "titlebar-btn titlebar-btn-close";
  closeBtn.ariaLabel = t("close");
  closeBtn.append(
    controlSvg([
      {
        tag: "path",
        attrs: { d: "M2.5 2.5l7 7M9.5 2.5l-7 7", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round" },
      },
    ]),
  );
  closeBtn.onclick = () => controls.close();

  const renderState = (state: TitlebarState) => {
    applyThemeVars(state.theme);
    bar.classList.toggle("platform-darwin", state.platform === "darwin");
    titleSpan.textContent = state.title;
    if (state.platform === "darwin") {
      buttons.replaceChildren();
      return;
    }
    maxBtn.ariaLabel = state.isMaximized ? t("restore") : t("maximize");
    maxBtn.replaceChildren(
      controlSvg(
        state.isMaximized
          ? [
              { tag: "rect", attrs: { x: "2", y: "3.5", width: "6.5", height: "6.5", stroke: "currentColor", "stroke-width": "1.1" } },
              { tag: "path", attrs: { d: "M3.8 3.5V2h6.2v6.2H8.5", stroke: "currentColor", "stroke-width": "1.1" } },
            ]
          : [{ tag: "rect", attrs: { x: "2", y: "2", width: "8", height: "8", stroke: "currentColor", "stroke-width": "1.1" } }],
      ),
    );
    if (!buttons.contains(minBtn)) buttons.replaceChildren(minBtn, maxBtn, closeBtn);
  };

  bar.append(buttons);
  document.body.replaceChildren(bar);

  renderState(await controls.getState());
  controls.onState(renderState);
}
