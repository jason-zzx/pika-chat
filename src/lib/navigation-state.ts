import { z } from "zod";

import {
  assistantDraftHref,
  assistantTopicHref,
  parseAssistantPath,
} from "@/lib/assistant-path";

export const MAX_WORKSPACE_TOPICS = 20;
export const NAV_STATE_STORAGE_KEY = "pika.navState";

export type AppNavState = {
  mode: "app" | "auth";
  /** Always starts with "/" when mode === "app". Max length = 1 + MAX_WORKSPACE_TOPICS. */
  workspaceStack: string[];
  /** Non-null only while inside /settings/*. Length 1 (tab) or 2 (mobile provider detail). */
  settingsStack: string[] | null;
  /** Used when mode === "auth". Bottom is "/sign-in" or "/setup". */
  authStack: string[];
};

const AUTH_ROOT_PATHS = new Set(["/sign-in", "/setup"]);
const AUTH_SUB_PATHS = new Set(["/sign-up", "/two-factor"]);

const pathSchema = z.string().startsWith("/");

const appNavStateSchema = z.object({
  mode: z.enum(["app", "auth"]),
  workspaceStack: z.array(pathSchema),
  settingsStack: z.array(pathSchema).nullable(),
  authStack: z.array(pathSchema),
});

function normalizePath(raw: string): string {
  const clean = (raw.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
  return clean.startsWith("/") ? clean : `/${clean}`;
}

export function isSettingsPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/settings" || path.startsWith("/settings/");
}

export function isProviderDetailPath(pathname: string): boolean {
  const segments = normalizePath(pathname)
    .split("/")
    .filter((segment) => segment.length > 0);
  return (
    segments.length === 3 &&
    segments[0] === "settings" &&
    segments[1] === "providers"
  );
}

export function isAuthRootPath(pathname: string): boolean {
  return AUTH_ROOT_PATHS.has(normalizePath(pathname));
}

export function isAuthPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return AUTH_ROOT_PATHS.has(path) || AUTH_SUB_PATHS.has(path);
}

export function isAssistantDraftPath(pathname: string): boolean {
  const { assistantId, topicId } = parseAssistantPath(normalizePath(pathname));
  return assistantId !== undefined && topicId === undefined;
}

export function isTopicPath(pathname: string): boolean {
  const { assistantId, topicId } = parseAssistantPath(normalizePath(pathname));
  return assistantId !== undefined && topicId !== undefined;
}

function ensureWorkspaceBase(stack: string[]): string[] {
  const tail = stack.filter(
    (entry) => entry !== "/" && !isSettingsPath(entry) && !isAuthPath(entry),
  );
  return ["/", ...tail.slice(-MAX_WORKSPACE_TOPICS)];
}

function pushWorkspaceEntry(stack: string[], path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return ["/"];
  }
  const tail = ensureWorkspaceBase(stack)
    .slice(1)
    .filter((entry) => entry !== normalized);
  tail.push(normalized);
  return ["/", ...tail.slice(-MAX_WORKSPACE_TOPICS)];
}

function buildSettingsStack(
  pathname: string,
  isMobile: boolean | undefined,
): string[] {
  const path = normalizePath(pathname);
  if (isProviderDetailPath(path) && isMobile) {
    return ["/settings/providers", path];
  }
  return [path];
}

function buildAuthStack(prev: AppNavState, pathname: string): string[] {
  const path = normalizePath(pathname);
  if (isAuthRootPath(path)) {
    return [path];
  }
  const existingRoot = prev.mode === "auth" ? prev.authStack[0] : undefined;
  const root =
    existingRoot !== undefined && isAuthRootPath(existingRoot)
      ? existingRoot
      : "/sign-in";
  return [root, path];
}

export function currentPath(state: AppNavState): string {
  if (state.mode === "auth") {
    return state.authStack.at(-1) ?? "/sign-in";
  }
  if (state.settingsStack !== null && state.settingsStack.length > 0) {
    return state.settingsStack.at(-1) ?? "/settings/general";
  }
  return state.workspaceStack.at(-1) ?? "/";
}

export function canGoBack(state: AppNavState): boolean {
  if (state.mode === "auth") {
    return state.authStack.length > 1;
  }
  if (state.settingsStack !== null && state.settingsStack.length > 0) {
    return true;
  }
  return state.workspaceStack.length > 1;
}

export function openHome(): AppNavState {
  return {
    mode: "app",
    workspaceStack: ["/"],
    settingsStack: null,
    authStack: [],
  };
}

export function openAssistant(
  state: AppNavState,
  assistantId: string,
): AppNavState {
  const base = state.mode === "app" ? state.workspaceStack : ["/"];
  return {
    mode: "app",
    workspaceStack: pushWorkspaceEntry(base, assistantDraftHref(assistantId)),
    settingsStack: null,
    authStack: [],
  };
}

export function openTopic(
  state: AppNavState,
  assistantId: string,
  topicId: string,
  options: { isMobile: boolean },
): AppNavState {
  const base =
    state.mode === "app" ? ensureWorkspaceBase(state.workspaceStack) : ["/"];
  const top = base.at(-1) ?? "/";
  const nextBase =
    options.isMobile && isAssistantDraftPath(top) ? base.slice(0, -1) : base;
  return {
    mode: "app",
    workspaceStack: pushWorkspaceEntry(
      nextBase,
      assistantTopicHref(assistantId, topicId),
    ),
    settingsStack: null,
    authStack: [],
  };
}

export function promoteDraftToTopic(
  state: AppNavState,
  assistantId: string,
  topicId: string,
): AppNavState {
  const base =
    state.mode === "app" ? ensureWorkspaceBase(state.workspaceStack) : ["/"];
  const top = base.at(-1) ?? "/";
  const target = assistantTopicHref(assistantId, topicId);
  // From "/" keep Home beneath the new topic; from an assistant draft replace
  // the draft with the topic it just became.
  const nextBase = isAssistantDraftPath(top) ? base.slice(0, -1) : base;
  return {
    mode: "app",
    workspaceStack: pushWorkspaceEntry(nextBase, target),
    settingsStack: null,
    authStack: [],
  };
}

export function openSettings(
  state: AppNavState,
  tab = "/settings/general",
): AppNavState {
  const workspaceStack =
    state.mode === "app" ? ensureWorkspaceBase(state.workspaceStack) : ["/"];
  return {
    mode: "app",
    workspaceStack,
    settingsStack: [normalizePath(tab)],
    authStack: [],
  };
}

export function openProviderDetail(
  state: AppNavState,
  configId: string,
  options: { isMobile: boolean },
): AppNavState {
  const workspaceStack =
    state.mode === "app" ? ensureWorkspaceBase(state.workspaceStack) : ["/"];
  return {
    mode: "app",
    workspaceStack,
    settingsStack: buildSettingsStack(
      `/settings/providers/${configId}`,
      options.isMobile,
    ),
    authStack: [],
  };
}

export function purgeTopic(
  state: AppNavState,
  topicId: string,
  fallbackHref = "/",
): AppNavState {
  if (state.mode !== "app") {
    return state;
  }
  const base = ensureWorkspaceBase(state.workspaceStack);
  const viewingDeleted =
    state.settingsStack === null &&
    parseAssistantPath(base.at(-1) ?? "/").topicId === topicId;
  const filtered = ensureWorkspaceBase(
    base.filter((entry) => parseAssistantPath(entry).topicId !== topicId),
  );
  if (!viewingDeleted) {
    return { ...state, workspaceStack: filtered };
  }
  const fallback = normalizePath(fallbackHref);
  if (fallback === "/") {
    return openHome();
  }
  return {
    mode: "app",
    workspaceStack: pushWorkspaceEntry(filtered, fallback),
    settingsStack: null,
    authStack: [],
  };
}

export function purgeAssistant(
  state: AppNavState,
  assistantId: string,
): AppNavState {
  if (state.mode !== "app") {
    return state;
  }
  const base = ensureWorkspaceBase(state.workspaceStack);
  const viewingDeleted =
    state.settingsStack === null &&
    parseAssistantPath(base.at(-1) ?? "/").assistantId === assistantId;
  if (viewingDeleted) {
    return openHome();
  }
  const filtered = ensureWorkspaceBase(
    base.filter((entry) => parseAssistantPath(entry).assistantId !== assistantId),
  );
  return { ...state, workspaceStack: filtered };
}

export function resetToAuth(
  rootPath: "/sign-in" | "/setup" = "/sign-in",
): AppNavState {
  return {
    mode: "auth",
    workspaceStack: [],
    settingsStack: null,
    authStack: [rootPath],
  };
}

export function syncPathname(
  state: AppNavState,
  pathname: string,
  options?: { isMobile?: boolean },
): AppNavState {
  const path = normalizePath(pathname);
  if (currentPath(state) === path) {
    if (
      state.mode === "app" &&
      state.settingsStack !== null &&
      isProviderDetailPath(path) &&
      options?.isMobile !== undefined
    ) {
      const nextSettings = buildSettingsStack(path, options.isMobile);
      if (nextSettings.length !== state.settingsStack.length) {
        return { ...state, settingsStack: nextSettings };
      }
    }
    return state;
  }

  if (isAuthPath(path)) {
    return {
      mode: "auth",
      workspaceStack: [],
      settingsStack: null,
      authStack: buildAuthStack(state, path),
    };
  }

  if (path === "/") {
    return openHome();
  }

  if (isSettingsPath(path)) {
    const workspaceStack =
      state.mode === "app" ? ensureWorkspaceBase(state.workspaceStack) : ["/"];
    return {
      mode: "app",
      workspaceStack,
      settingsStack: buildSettingsStack(path, options?.isMobile),
      authStack: [],
    };
  }

  const base =
    state.mode === "app" ? ensureWorkspaceBase(state.workspaceStack) : ["/"];
  const top = base.at(-1) ?? "/";
  const nextBase =
    isTopicPath(path) && options?.isMobile && isAssistantDraftPath(top)
      ? base.slice(0, -1)
      : base;
  return {
    mode: "app",
    workspaceStack: pushWorkspaceEntry(nextBase, path),
    settingsStack: null,
    authStack: [],
  };
}

export function exitSettings(state: AppNavState): {
  state: AppNavState;
  target: string | null;
} {
  if (
    state.mode !== "app" ||
    state.settingsStack === null ||
    state.settingsStack.length === 0
  ) {
    return { state, target: null };
  }
  const workspaceStack = ensureWorkspaceBase(state.workspaceStack);
  return {
    state: {
      mode: "app",
      workspaceStack,
      settingsStack: null,
      authStack: [],
    },
    target: workspaceStack.at(-1) ?? "/",
  };
}

export function stepBack(state: AppNavState): {
  state: AppNavState;
  target: string | null;
} {
  if (state.mode === "auth") {
    if (state.authStack.length <= 1) {
      return { state, target: null };
    }
    const nextAuth = state.authStack.slice(0, -1);
    return {
      state: { ...state, authStack: nextAuth },
      target: nextAuth.at(-1) ?? "/sign-in",
    };
  }

  if (state.settingsStack !== null && state.settingsStack.length > 0) {
    if (state.settingsStack.length > 1) {
      const nextSettings = state.settingsStack.slice(0, -1);
      return {
        state: { ...state, settingsStack: nextSettings },
        target: nextSettings.at(-1) ?? "/settings/general",
      };
    }
    return exitSettings(state);
  }

  if (state.workspaceStack.length <= 1) {
    return { state, target: null };
  }
  const nextWorkspace = state.workspaceStack.slice(0, -1);
  return {
    state: {
      mode: "app",
      workspaceStack: nextWorkspace,
      settingsStack: null,
      authStack: [],
    },
    target: nextWorkspace.at(-1) ?? "/",
  };
}

function sanitizeLoadedState(raw: z.infer<typeof appNavStateSchema>): AppNavState {
  if (raw.mode === "auth") {
    const valid = raw.authStack.map(normalizePath).filter(isAuthPath);
    const last = valid.at(-1) ?? "/sign-in";
    if (isAuthRootPath(last)) {
      return resetToAuth(last === "/setup" ? "/setup" : "/sign-in");
    }
    const root = valid[0] && isAuthRootPath(valid[0]) ? valid[0] : "/sign-in";
    return { mode: "auth", workspaceStack: [], settingsStack: null, authStack: [root, last] };
  }

  const workspaceStack = raw.workspaceStack
    .map(normalizePath)
    .filter((entry) => entry !== "/" && !isSettingsPath(entry) && !isAuthPath(entry))
    .reduce(pushWorkspaceEntry, ["/"]);
  const validSettings = (raw.settingsStack ?? []).map(normalizePath).filter(isSettingsPath);
  const lastSetting = validSettings.at(-1);
  return {
    mode: "app",
    workspaceStack,
    settingsStack: lastSetting
      ? buildSettingsStack(lastSetting, validSettings.length >= 2)
      : null,
    authStack: [],
  };
}

export function loadNavState(): AppNavState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(NAV_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = appNavStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }
    return sanitizeLoadedState(parsed.data);
  } catch {
    return null;
  }
}

export function saveNavState(state: AppNavState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(NAV_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota); in-memory stack still works.
  }
}

export function clearNavState(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(NAV_STATE_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
