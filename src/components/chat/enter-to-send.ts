import type { KeyboardEvent } from "react";

function canEnterSend(): boolean {
  // Native bridges decide unambiguously: Electron desktop always allows
  // Enter-to-send; Android mobile always keeps Enter as newline.
  if (window.pikaNative) {
    return Boolean(window.pikaNative.desktop);
  }
  // Guard for jsdom tests that do not stub matchMedia.
  if (typeof window.matchMedia !== "function") {
    return true;
  }
  return !window.matchMedia("(pointer: coarse)").matches;
}

/**
 * True when a textarea Enter keypress should submit the message rather than
 * insert a newline or confirm an active IME composition.
 */
export function shouldSendOnEnter(
  event: KeyboardEvent<HTMLTextAreaElement>,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    canEnterSend()
  );
}
