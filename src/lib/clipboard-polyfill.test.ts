// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { installClipboardPolyfill } from "./clipboard-polyfill";

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

function stubExecCommand(impl: () => boolean) {
  Object.defineProperty(document, "execCommand", {
    value: vi.fn(impl),
    configurable: true,
    writable: true,
  });
  return document.execCommand as unknown as ReturnType<typeof vi.fn>;
}

function polyfilledClipboard(): Clipboard {
  return navigator.clipboard;
}

afterEach(() => {
  stubClipboard(undefined);
  Reflect.deleteProperty(document, "execCommand");
});

describe("installClipboardPolyfill", () => {
  it("leaves an existing native clipboard untouched", () => {
    const native = { writeText: vi.fn() };
    stubClipboard(native);

    installClipboardPolyfill();

    expect(navigator.clipboard).toBe(native);
  });

  it("installs writeText that copies through the execCommand fallback", async () => {
    stubClipboard(undefined);
    const execCommand = stubExecCommand(() => true);

    installClipboardPolyfill();

    await expect(
      polyfilledClipboard().writeText("lan copy"),
    ).resolves.toBeUndefined();
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The helper textarea must not linger in the DOM.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("rejects writeText when the legacy path fails", async () => {
    stubClipboard(undefined);
    stubExecCommand(() => false);

    installClipboardPolyfill();

    await expect(polyfilledClipboard().writeText("hello")).rejects.toThrow();
  });

  it("write extracts the text/plain part of ClipboardItems (table copy)", async () => {
    stubClipboard(undefined);
    let copied: string | undefined;
    stubExecCommand(() => {
      // legacyCopy fills a hidden textarea before calling execCommand.
      copied = document.querySelector("textarea")?.value;
      return true;
    });

    installClipboardPolyfill();

    const item = {
      types: ["text/html", "text/plain"],
      getType: vi.fn((type: string) =>
        Promise.resolve(
          new Blob([type === "text/plain" ? "plain table" : "<table/>"], {
            type,
          }),
        ),
      ),
    } as unknown as ClipboardItem;

    await expect(
      polyfilledClipboard().write([item]),
    ).resolves.toBeUndefined();
    // The plain-text blob is copied, not the HTML one.
    expect(item.getType).toHaveBeenCalledWith("text/plain");
    expect(copied).toBe("plain table");
  });

  it("write rejects when no item carries text/plain", async () => {
    stubClipboard(undefined);
    stubExecCommand(() => true);

    installClipboardPolyfill();

    const item = {
      types: ["text/html"],
      getType: vi.fn(),
    } as unknown as ClipboardItem;

    await expect(polyfilledClipboard().write([item])).rejects.toThrow();
  });
});
