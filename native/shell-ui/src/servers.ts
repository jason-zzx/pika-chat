import type { ServerCheck } from "./host";

export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  return url.origin;
}

export function sameMajorMinor(serverVersion: string | null, appVersion: string): boolean {
  if (serverVersion === null) return false;
  const [serverMajor, serverMinor] = serverVersion.split(".");
  const [appMajor, appMinor] = appVersion.split(".");
  return serverMajor === appMajor && serverMinor === appMinor;
}

export function classifyHealth(responseOk: boolean, body: unknown): ServerCheck {
  if (!responseOk || typeof body !== "object" || body === null || !("ok" in body) || body.ok !== true) {
    return { ok: false, reason: "not-pika" };
  }
  return { ok: true, version: "version" in body && typeof body.version === "string" ? body.version : null };
}

export type KeyInput = {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const SAME_NAME_KEYS = new Set(["Space", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown"]);

const NAMED_KEYS: Record<string, string> = {
  Enter: "Return",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
};

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (SAME_NAME_KEYS.has(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

/**
 * Electron accelerator for a keydown, or null for modifier-only presses and
 * combinations without a non-Shift modifier (Shift+letter would hijack typing).
 * Uses `code` so the shortcut does not depend on the keyboard layout.
 */
export function acceleratorFromKey(input: KeyInput, isMac: boolean): string | null {
  const key = keyName(input.code);
  const primary = isMac ? input.metaKey : input.ctrlKey;
  const secondary = isMac ? input.ctrlKey : input.metaKey;
  if (!key || !(primary || secondary || input.altKey)) return null;
  return [
    primary && "CommandOrControl",
    secondary && (isMac ? "Control" : "Super"),
    input.altKey && "Alt",
    input.shiftKey && "Shift",
    key,
  ]
    .filter((part) => part !== false)
    .join("+");
}
