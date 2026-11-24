import type { Server } from "./host";

export const LOCAL_SERVER_ID = "local";

export type ShellScreen =
  | { kind: "welcome" }
  | { kind: "list" }
  | { kind: "form"; server?: Server; allowCancel: boolean }
  | { kind: "mobileSettings" }
  | { kind: "connecting"; serverId: string; skipVersionCheck?: boolean }
  | { kind: "versionWarning"; server: Server; serverVersion: string | null }
  | { kind: "error"; serverId: string; reason: "unreachable" | "not-pika"; detail?: string };

export type InitialStackInput = {
  search: string;
  servers: Server[];
  lastServerId: string | null;
  hasDesktop: boolean;
};

export function resolveInitialStack(input: InitialStackInput): ShellScreen[] {
  const params = new URLSearchParams(input.search);
  const failedId = params.get("failed");
  const connectId = params.get("connect");

  if (input.hasDesktop && failedId === LOCAL_SERVER_ID) {
    return [{ kind: "error", serverId: LOCAL_SERVER_ID, reason: "unreachable" }];
  }
  if (failedId && input.servers.some((s) => s.id === failedId)) {
    return [{ kind: "error", serverId: failedId, reason: "unreachable" }];
  }
  if (input.hasDesktop && connectId === LOCAL_SERVER_ID) {
    return [{ kind: "connecting", serverId: LOCAL_SERVER_ID }];
  }
  if (connectId && input.servers.some((s) => s.id === connectId)) {
    return [{ kind: "connecting", serverId: connectId }];
  }
  if (params.has("add")) {
    return [{ kind: "form", allowCancel: true }];
  }
  if (input.search === "") {
    if (input.hasDesktop && input.lastServerId === LOCAL_SERVER_ID) {
      return [{ kind: "connecting", serverId: LOCAL_SERVER_ID }];
    }
    if (input.lastServerId && input.servers.some((s) => s.id === input.lastServerId)) {
      return [{ kind: "connecting", serverId: input.lastServerId }];
    }
    if (input.servers.length === 0) {
      return input.hasDesktop ? [{ kind: "welcome" }] : [{ kind: "form", allowCancel: false }];
    }
  }
  return [{ kind: "list" }];
}

export function canShellGoBack(
  stack: readonly ShellScreen[],
  activeServerId: string | null,
  dialogOpen: boolean,
): boolean {
  return stepShellBack(stack, activeServerId, dialogOpen).action !== "noop";
}

export type BackOutcome =
  | { action: "closeDialog" }
  | { action: "pop"; stack: ShellScreen[] }
  | { action: "returnToServer" }
  | { action: "noop" };

export function stepShellBack(
  stack: readonly ShellScreen[],
  activeServerId: string | null,
  dialogOpen: boolean,
): BackOutcome {
  if (dialogOpen) return { action: "closeDialog" };
  if (stack.length > 1) return { action: "pop", stack: stack.slice(0, -1) };
  if (activeServerId !== null) return { action: "returnToServer" };
  return { action: "noop" };
}
