import { describe, expect, it } from "vitest";

import { acceleratorFromKey, formatAccelerator } from "./desktop-hotkey";

describe("desktop-hotkey", () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

  it("maps CommandOrControl per platform", () => {
    expect(acceleratorFromKey({ ...none, ctrlKey: true, shiftKey: true, code: "Space" }, false)).toBe(
      "CommandOrControl+Shift+Space",
    );
    expect(acceleratorFromKey({ ...none, metaKey: true, shiftKey: true, code: "Space" }, true)).toBe(
      "CommandOrControl+Shift+Space",
    );
    expect(formatAccelerator("CommandOrControl+Shift+Space", false)).toBe("Ctrl+Shift+Space");
    expect(formatAccelerator("CommandOrControl+Shift+Space", true)).toBe("Cmd+Shift+Space");
  });

  it("keeps the secondary modifier distinct and maps named keys", () => {
    expect(acceleratorFromKey({ ...none, ctrlKey: true, code: "KeyK" }, true)).toBe("Control+K");
    expect(acceleratorFromKey({ ...none, metaKey: true, code: "KeyK" }, false)).toBe("Super+K");
    expect(acceleratorFromKey({ ...none, altKey: true, code: "Digit1" }, false)).toBe("Alt+1");
    expect(acceleratorFromKey({ ...none, altKey: true, code: "F12" }, false)).toBe("Alt+F12");
    expect(acceleratorFromKey({ ...none, altKey: true, code: "ArrowUp" }, false)).toBe("Alt+Up");
    expect(acceleratorFromKey({ ...none, altKey: true, code: "Enter" }, false)).toBe("Alt+Return");
  });

  it("rejects modifier-only and unmodified keys", () => {
    expect(acceleratorFromKey({ ...none, ctrlKey: true, code: "ControlLeft" }, false)).toBeNull();
    expect(acceleratorFromKey({ ...none, code: "KeyA" }, false)).toBeNull();
    expect(acceleratorFromKey({ ...none, shiftKey: true, code: "KeyA" }, false)).toBeNull();
  });
});
