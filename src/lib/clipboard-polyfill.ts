import { legacyCopyTextToClipboard } from "./clipboard";

/**
 * Minimal `navigator.clipboard` polyfill for insecure contexts.
 *
 * Streamdown's built-in copy buttons (code blocks, mermaid diagrams, tables)
 * call `navigator.clipboard.writeText` / `.write` directly. That API is
 * undefined over plain http (e.g. a LAN IP from a phone) and cannot be
 * injected with the project's `copyTextToClipboard` helper, so define a
 * stand-in that routes through the same legacy textarea + execCommand
 * fallback. No-op when the native API exists or outside the browser.
 *
 * The legacy path is used directly instead of `copyTextToClipboard` because
 * that helper consults `navigator.clipboard.writeText` first — which, once
 * this polyfill is installed, is the polyfill itself (infinite recursion).
 */
export function installClipboardPolyfill(): void {
  if (typeof navigator === "undefined" || navigator.clipboard) {
    return;
  }
  Object.defineProperty(navigator, "clipboard", {
    value: {
      async writeText(text: string): Promise<void> {
        if (!legacyCopyTextToClipboard(text)) {
          throw new Error("Copy failed");
        }
      },
      // Table copy passes ClipboardItems with text/html + text/plain; the
      // legacy path can only copy plain text, so extract that part.
      async write(items: ClipboardItem[]): Promise<void> {
        const plain = await extractPlainText(items);
        if (plain === undefined || !legacyCopyTextToClipboard(plain)) {
          throw new Error("Copy failed");
        }
      },
    },
    configurable: true,
  });
}

async function extractPlainText(
  items: ClipboardItem[],
): Promise<string | undefined> {
  for (const item of items) {
    if (!item.types.includes("text/plain")) {
      continue;
    }
    try {
      const blob = await item.getType("text/plain");
      return await blob.text();
    } catch {
      // Unreadable item: keep looking.
    }
  }
  return undefined;
}
