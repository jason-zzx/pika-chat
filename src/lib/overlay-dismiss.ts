const DISMISSIBLE_OVERLAY_SELECTOR = [
  '[data-open][role="dialog"]',
  '[data-open][role="alertdialog"]',
  '[data-open][data-slot="dropdown-menu-content"]',
  '[data-open][data-slot="dropdown-menu-sub-content"]',
  '[data-open][data-slot="popover-content"]',
  '[data-open][data-slot="select-content"]',
].join(", ");

/** True when any dismissible Base UI modal/sheet/menu/popover/select is open. */
export function hasOpenOverlay(): boolean {
  return document.querySelector(DISMISSIBLE_OVERLAY_SELECTOR) !== null;
}

/**
 * Observe transitions in open dismissible overlay state. Calls `onChange` only
 * when the boolean flips between `false` and `true`.
 */
export function observeOpenOverlay(
  onChange: (open: boolean) => void,
): () => void {
  let current = hasOpenOverlay();
  const observer = new MutationObserver(() => {
    const next = hasOpenOverlay();
    if (next !== current) {
      current = next;
      onChange(next);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-open", "data-slot", "role"],
  });
  return () => observer.disconnect();
}

/**
 * Dismiss the topmost open overlay via a synthetic Escape keydown event.
 * Returns `true` if an overlay was open and Back should be considered consumed.
 */
export function dismissTopOverlay(): boolean {
  const overlays = document.querySelectorAll(DISMISSIBLE_OVERLAY_SELECTOR);
  if (overlays.length === 0) {
    return false;
  }
  const topmost = overlays.item(overlays.length - 1);
  const active = document.activeElement;
  const target =
    active instanceof Element && topmost !== null && topmost.contains(active)
      ? active
      : (topmost ?? document.body);
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}
