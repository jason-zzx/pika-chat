/**
 * Copy text to the clipboard with a legacy fallback.
 *
 * `navigator.clipboard` is only available in secure contexts, so plain-http
 * access (e.g. a LAN IP from a phone) leaves it undefined; it can also
 * reject on permission denial. In both cases fall back to a hidden textarea
 * + `document.execCommand("copy")`. Returns false only when both paths fail
 * so the caller can surface a visible failure state (B9/R11).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or transient failure: try the legacy path.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Invisible but still selectable: display:none / visibility:hidden would
  // prevent the selection execCommand copies.
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  // Mobile browsers (iOS Safari especially) need an explicit range.
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
