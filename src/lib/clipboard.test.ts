// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

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

afterEach(() => {
  stubClipboard(undefined);
  Reflect.deleteProperty(document, "execCommand");
});

describe("copyTextToClipboard", () => {
  it("uses the async clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const execCommand = stubExecCommand(() => true);

    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the clipboard API is missing (insecure context)", async () => {
    stubClipboard(undefined);
    const execCommand = stubExecCommand(() => true);

    await expect(copyTextToClipboard("lan copy")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The helper textarea must not linger in the DOM.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to execCommand when the clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard({ writeText });
    const execCommand = stubExecCommand(() => true);

    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when the clipboard rejects and execCommand fails", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    stubExecCommand(() => false);

    await expect(copyTextToClipboard("hello")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports failure when the clipboard is missing and execCommand throws", async () => {
    stubClipboard(undefined);
    stubExecCommand(() => {
      throw new Error("not supported");
    });

    await expect(copyTextToClipboard("hello")).resolves.toBe(false);
  });
});
