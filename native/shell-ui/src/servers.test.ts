import { describe, expect, it } from "vitest";
import { acceleratorFromKey, classifyHealth, isNewerVersion, normalizeServerUrl, sameMajorMinor } from "./servers";

describe("normalizeServerUrl", () => {
  it("assumes https and reduces to an origin", () => {
    expect(normalizeServerUrl("chat.example.com")).toBe("https://chat.example.com");
    expect(normalizeServerUrl("  https://chat.example.com/some/path?q=1#h ")).toBe("https://chat.example.com");
    expect(normalizeServerUrl("localhost:3000/")).toBe("https://localhost:3000");
  });

  it("keeps an explicit http scheme and drops default ports", () => {
    expect(normalizeServerUrl("http://192.168.1.5:3000")).toBe("http://192.168.1.5:3000");
    expect(normalizeServerUrl("http://example.com:80")).toBe("http://example.com");
  });

  it("rejects empty input and non-http schemes", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("ftp://example.com")).toBeNull();
    expect(normalizeServerUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeServerUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("sameMajorMinor", () => {
  it("ignores the patch level", () => {
    expect(sameMajorMinor("0.4.2", "0.4.9")).toBe(true);
    expect(sameMajorMinor("0.4.2", "0.5.0")).toBe(false);
    expect(sameMajorMinor("1.4.2", "0.4.2")).toBe(false);
  });

  it("treats a missing server version as a mismatch", () => {
    expect(sameMajorMinor(null, "0.4.2")).toBe(false);
  });
});

describe("classifyHealth", () => {
  it("accepts a Pika health body", () => {
    expect(classifyHealth(true, { ok: true, version: "0.4.2" })).toEqual({ ok: true, version: "0.4.2" });
  });

  it("returns a null version for older servers", () => {
    expect(classifyHealth(true, { ok: true })).toEqual({ ok: true, version: null });
  });

  it("rejects anything else", () => {
    expect(classifyHealth(false, { ok: true })).toEqual({ ok: false, reason: "not-pika" });
    expect(classifyHealth(true, null)).toEqual({ ok: false, reason: "not-pika" });
    expect(classifyHealth(true, "ok")).toEqual({ ok: false, reason: "not-pika" });
    expect(classifyHealth(true, { ok: false })).toEqual({ ok: false, reason: "not-pika" });
  });
});

describe("acceleratorFromKey", () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

  it("maps the primary modifier to CommandOrControl per platform", () => {
    expect(acceleratorFromKey({ ...none, ctrlKey: true, shiftKey: true, code: "Space" }, false)).toBe(
      "CommandOrControl+Shift+Space",
    );
    expect(acceleratorFromKey({ ...none, metaKey: true, shiftKey: true, code: "Space" }, true)).toBe(
      "CommandOrControl+Shift+Space",
    );
  });

  it("keeps the secondary modifier distinct", () => {
    expect(acceleratorFromKey({ ...none, ctrlKey: true, code: "KeyK" }, true)).toBe("Control+K");
    expect(acceleratorFromKey({ ...none, metaKey: true, code: "KeyK" }, false)).toBe("Super+K");
  });

  it("names keys from their physical code", () => {
    expect(acceleratorFromKey({ ...none, altKey: true, code: "Digit1" }, false)).toBe("Alt+1");
    expect(acceleratorFromKey({ ...none, altKey: true, code: "F12" }, false)).toBe("Alt+F12");
    expect(acceleratorFromKey({ ...none, altKey: true, code: "ArrowUp" }, false)).toBe("Alt+Up");
  });

  it("rejects modifier-only, unmodified and shift-only presses", () => {
    expect(acceleratorFromKey({ ...none, ctrlKey: true, code: "ControlLeft" }, false)).toBeNull();
    expect(acceleratorFromKey({ ...none, code: "KeyA" }, false)).toBeNull();
    expect(acceleratorFromKey({ ...none, shiftKey: true, code: "KeyA" }, false)).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("treats strictly higher stable versions as newer", () => {
    expect(isNewerVersion("v0.4.3", "0.4.2")).toBe(true);
    expect(isNewerVersion("v0.5.0", "0.4.9")).toBe(true);
    expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(true);
  });

  it("does not downgrade an rc user to an older stable release", () => {
    expect(isNewerVersion("v0.4.2", "0.4.3-rc.1")).toBe(false);
    expect(isNewerVersion("v0.4.2", "0.5.0-rc.1")).toBe(false);
  });

  it("prompts rc users when the matching stable version ships", () => {
    expect(isNewerVersion("v0.4.3", "0.4.3-rc.1")).toBe(true);
  });

  it("compares prerelease identifiers numerically and lexically", () => {
    expect(isNewerVersion("v0.4.3-rc.2", "0.4.3-rc.1")).toBe(true);
    expect(isNewerVersion("v0.4.3-rc.10", "0.4.3-rc.2")).toBe(true);
    expect(isNewerVersion("v0.4.3-rc.1", "0.4.3-rc.2")).toBe(false);
    expect(isNewerVersion("v0.4.3-beta.1", "0.4.3-alpha.9")).toBe(true);
  });

  it("ignores equal and unparseable versions", () => {
    expect(isNewerVersion("v0.4.2", "0.4.2")).toBe(false);
    expect(isNewerVersion("v0.4.3-rc.1", "0.4.3-rc.1")).toBe(false);
    expect(isNewerVersion("invalid", "0.4.2")).toBe(false);
    expect(isNewerVersion("v0.4.3", "invalid")).toBe(false);
  });
});
