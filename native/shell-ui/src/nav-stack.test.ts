import { describe, expect, it } from "vitest";
import type { Server } from "./host";
import {
  LOCAL_SERVER_ID,
  canShellGoBack,
  resolveInitialStack,
  stepShellBack,
  type ShellScreen,
} from "./nav-stack";

const s1: Server = { id: "s1", name: "Alpha", url: "https://alpha.example.com" };
const s2: Server = { id: "s2", name: "Beta", url: "https://beta.example.com" };

describe("resolveInitialStack", () => {
  it("routes explicit query modes to single-entry stacks", () => {
    expect(resolveInitialStack({ search: "?list", servers: [s1], lastServerId: "s1", hasDesktop: true })).toEqual([
      { kind: "list" },
    ]);
    expect(resolveInitialStack({ search: "?add", servers: [s1], lastServerId: "s1", hasDesktop: true })).toEqual([
      { kind: "form", allowCancel: true },
    ]);
    expect(resolveInitialStack({ search: "?connect=s2", servers: [s1, s2], lastServerId: "s1", hasDesktop: false })).toEqual([
      { kind: "connecting", serverId: "s2" },
    ]);
    expect(resolveInitialStack({ search: "?failed=s1", servers: [s1], lastServerId: "s1", hasDesktop: false })).toEqual([
      { kind: "error", serverId: "s1", reason: "unreachable" },
    ]);
  });

  it("handles desktop local server connect and failed modes", () => {
    expect(
      resolveInitialStack({ search: "?connect=local", servers: [], lastServerId: null, hasDesktop: true }),
    ).toEqual([{ kind: "connecting", serverId: LOCAL_SERVER_ID }]);
    expect(
      resolveInitialStack({ search: "?failed=local", servers: [], lastServerId: null, hasDesktop: true }),
    ).toEqual([{ kind: "error", serverId: LOCAL_SERVER_ID, reason: "unreachable" }]);
    // Mobile ignores local ids and falls back to list.
    expect(
      resolveInitialStack({ search: "?connect=local", servers: [s1], lastServerId: null, hasDesktop: false }),
    ).toEqual([{ kind: "list" }]);
  });

  it("falls back to list for unknown server ids", () => {
    expect(resolveInitialStack({ search: "?connect=missing", servers: [s1], lastServerId: "s1", hasDesktop: true })).toEqual([
      { kind: "list" },
    ]);
    expect(resolveInitialStack({ search: "?failed=missing", servers: [s1], lastServerId: "s1", hasDesktop: true })).toEqual([
      { kind: "list" },
    ]);
  });

  it("auto-connects on empty query or shows first-launch screen", () => {
    expect(resolveInitialStack({ search: "", servers: [s1], lastServerId: "s1", hasDesktop: false })).toEqual([
      { kind: "connecting", serverId: "s1" },
    ]);
    expect(resolveInitialStack({ search: "", servers: [], lastServerId: LOCAL_SERVER_ID, hasDesktop: true })).toEqual([
      { kind: "connecting", serverId: LOCAL_SERVER_ID },
    ]);
    expect(resolveInitialStack({ search: "", servers: [], lastServerId: null, hasDesktop: true })).toEqual([
      { kind: "welcome" },
    ]);
    expect(resolveInitialStack({ search: "", servers: [], lastServerId: null, hasDesktop: false })).toEqual([
      { kind: "form", allowCancel: false },
    ]);
    expect(resolveInitialStack({ search: "", servers: [s1], lastServerId: null, hasDesktop: false })).toEqual([
      { kind: "list" },
    ]);
  });
});

describe("stack transitions and back dispatch", () => {
  it("closes open dialog before popping stack or returning to active server", () => {
    const stack: ShellScreen[] = [{ kind: "list" }, { kind: "form", allowCancel: true }];
    expect(stepShellBack(stack, "s1", true)).toEqual({ action: "closeDialog" });
    expect(canShellGoBack([{ kind: "list" }], null, true)).toBe(true);
  });

  it("pops sub-screens back to list before returning to active server", () => {
    const stack: ShellScreen[] = [{ kind: "list" }, { kind: "error", serverId: "s2", reason: "unreachable" }];

    const step1 = stepShellBack(stack, "s1", false);
    expect(step1).toEqual({ action: "pop", stack: [{ kind: "list" }] });

    const step2 = stepShellBack([{ kind: "list" }], "s1", false);
    expect(step2).toEqual({ action: "returnToServer" });
  });

  it("becomes a no-op and disables back when at depth 1 with no active server", () => {
    const stack: ShellScreen[] = [{ kind: "list" }];
    expect(canShellGoBack(stack, null, false)).toBe(false);
    expect(stepShellBack(stack, null, false)).toEqual({ action: "noop" });
  });
});
