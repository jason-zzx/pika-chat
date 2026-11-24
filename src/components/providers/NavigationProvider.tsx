"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import { usePikaNative } from "@/hooks/use-pika-native";
import { useStableCallback } from "@/hooks/use-stable-callback";
import { assistantDraftHref, assistantTopicHref } from "@/lib/assistant-path";
import {
  type AppNavState,
  canGoBack,
  currentPath,
  exitSettings as exitSettingsState,
  isAuthRootPath,
  isProviderDetailPath,
  isSettingsPath,
  loadNavState,
  openAssistant as openAssistantState,
  openHome as openHomeState,
  openProviderDetail as openProviderDetailState,
  openSettings as openSettingsState,
  openTopic as openTopicState,
  promoteDraftToTopic as promoteDraftToTopicState,
  purgeAssistant as purgeAssistantState,
  purgeTopic as purgeTopicState,
  saveNavState,
  stepBack,
  syncPathname,
} from "@/lib/navigation-state";
import {
  dismissTopOverlay,
  hasOpenOverlay,
  observeOpenOverlay,
} from "@/lib/overlay-dismiss";

export type AppNavigation = {
  navigateHome: () => void;
  openAssistant: (assistantId: string) => void;
  openTopic: (assistantId: string, topicId: string, href?: string) => void;
  recordPromotedTopic: (assistantId: string, topicId: string) => void;
  openSettings: (tabHref?: string) => void;
  openProviderDetail: (configId: string) => void;
  exitSettings: () => void;
  goBack: () => void;
  purgeDeletedTopic: (topicId: string, fallbackHref?: string) => void;
  purgeDeletedAssistant: (assistantId: string) => void;
  openAuthPage: (path: string, options?: { refresh?: boolean }) => void;
  completeAuth: () => void;
};

const NavigationContext = createContext<AppNavigation | null>(null);

function createRouterFallback(
  router: ReturnType<typeof useRouter>,
): AppNavigation {
  return {
    navigateHome: () => router.push("/"),
    openAssistant: (id) => router.push(assistantDraftHref(id)),
    openTopic: (a, t, href) => router.push(href ?? assistantTopicHref(a, t)),
    recordPromotedTopic: () => {},
    openSettings: (tabHref = "/settings/general") => router.replace(tabHref),
    openProviderDetail: (id) => router.push(`/settings/providers/${id}`),
    exitSettings: () => router.replace("/"),
    goBack: () => router.replace("/"),
    purgeDeletedTopic: (_id, fallbackHref) => {
      if (fallbackHref !== undefined) {
        router.replace(fallbackHref);
      }
    },
    purgeDeletedAssistant: () => router.replace("/"),
    openAuthPage: (path, options) => {
      router[isAuthRootPath(path) ? "replace" : "push"](path);
      if (options?.refresh) {
        router.refresh();
      }
    },
    completeAuth: () => {
      router.replace("/");
      router.refresh();
    },
  };
}

export function useAppNavigation(): AppNavigation {
  const ctx = useContext(NavigationContext);
  const router = useRouter();
  return ctx ?? createRouterFallback(router);
}

/**
 * Owns the web app's logical navigation stack and bridges it to
 * `window.pikaNative.navigation` when running inside the Electron/Android
 * shells. Mounted once in AppProviders (above both app and auth layouts).
 *
 * State lives in a ref rather than React state so stack transitions never
 * re-render the whole subtree; consumers receive a referentially stable API.
 */
export default function NavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const native = usePikaNative();
  const isMobile = useIsMobile();

  const envRef = useRef({ router, pathname, native, isMobile });
  const prevPathnameRef = useRef(pathname);
  const stateRef = useRef<AppNavState | null>(null);
  const overlayOpenRef = useRef(false);
  const lastReportedCanGoBackRef = useRef<boolean | null>(null);
  // Standalone browser mode only: tracks whether Settings (and mobile provider
  // detail) was pushed in-app so `←` can cleanly pop via `router.back()`.
  const settingsBrowserDepthRef = useRef(0);
  const providerDetailPushedRef = useRef(false);

  const getState = useStableCallback((): AppNavState => {
    if (stateRef.current === null) {
      const { pathname: currentPathname, isMobile: mobile } = envRef.current;
      stateRef.current = syncPathname(
        loadNavState() ?? openHomeState(),
        currentPathname,
        { isMobile: mobile },
      );
    }
    return stateRef.current;
  });

  const syncNativeCanGoBack = useStableCallback(() => {
    const navBridge = envRef.current.native?.navigation;
    if (!navBridge) {
      return;
    }
    const nextCanGoBack = overlayOpenRef.current || canGoBack(getState());
    if (lastReportedCanGoBackRef.current === nextCanGoBack) {
      return;
    }
    lastReportedCanGoBackRef.current = nextCanGoBack;
    navBridge.setCanGoBack(nextCanGoBack);
  });

  const commitState = useStableCallback((next: AppNavState) => {
    stateRef.current = next;
    saveNavState(next);
    syncNativeCanGoBack();
  });

  // Keep env ref fresh and reconcile external route changes (initial load,
  // reload, notification deep links, <Link> clicks, redirects, browser Back/Forward).
  useEffect(() => {
    const prevPathname = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    envRef.current = { router, pathname, native, isMobile };

    if (prevPathname !== pathname) {
      if (!isSettingsPath(pathname)) {
        settingsBrowserDepthRef.current = 0;
        providerDetailPushedRef.current = false;
      } else if (
        !isSettingsPath(prevPathname) &&
        native === null &&
        settingsBrowserDepthRef.current === 0
      ) {
        settingsBrowserDepthRef.current = 1;
      } else if (
        isProviderDetailPath(prevPathname) &&
        !isProviderDetailPath(pathname) &&
        providerDetailPushedRef.current
      ) {
        providerDetailPushedRef.current = false;
        settingsBrowserDepthRef.current = Math.max(
          0,
          settingsBrowserDepthRef.current - 1,
        );
      }
    }

    const wasUninit = stateRef.current === null;
    const prev = getState();
    const next = wasUninit ? prev : syncPathname(prev, pathname, { isMobile });
    if (wasUninit || next !== prev) {
      commitState(next);
    }
  }, [router, pathname, native, isMobile, getState, commitState]);

  const commitWorkspace = useStableCallback(
    (next: AppNavState, href: string) => {
      const wasInSettings = getState().settingsStack !== null;
      commitState(next);
      settingsBrowserDepthRef.current = 0;
      providerDetailPushedRef.current = false;
      const { router: r, native: n } = envRef.current;
      r[n !== null || wasInSettings ? "replace" : "push"](href);
    },
  );

  const navigateHome = useStableCallback(() => {
    commitWorkspace(openHomeState(), "/");
  });

  const openAssistant = useStableCallback((assistantId: string) => {
    commitWorkspace(
      openAssistantState(getState(), assistantId),
      assistantDraftHref(assistantId),
    );
  });

  const openTopic = useStableCallback(
    (assistantId: string, topicId: string, href?: string) => {
      commitWorkspace(
        openTopicState(getState(), assistantId, topicId, {
          isMobile: envRef.current.isMobile,
        }),
        href ?? assistantTopicHref(assistantId, topicId),
      );
    },
  );

  const recordPromotedTopic = useStableCallback(
    (assistantId: string, topicId: string) => {
      commitState(promoteDraftToTopicState(getState(), assistantId, topicId));
    },
  );

  const openSettings = useStableCallback(
    (tabHref: string = "/settings/general") => {
      const prev = getState();
      const wasInSettings = prev.settingsStack !== null;
      commitState(openSettingsState(prev, tabHref));
      providerDetailPushedRef.current = false;

      const { router: r, native: n } = envRef.current;
      if (n === null && !wasInSettings) {
        settingsBrowserDepthRef.current = 1;
        r.push(tabHref);
        return;
      }
      r.replace(tabHref);
    },
  );

  const openProviderDetail = useStableCallback((configId: string) => {
    const { router: r, native: n, isMobile: mobile } = envRef.current;
    const href = `/settings/providers/${configId}`;
    commitState(
      openProviderDetailState(getState(), configId, { isMobile: mobile }),
    );
    if (n === null && mobile) {
      providerDetailPushedRef.current = true;
      settingsBrowserDepthRef.current += 1;
      r.push(href);
      return;
    }
    r.replace(href);
  });

  const leaveSettings = useStableCallback((target: string) => {
    const { router: r, native: n } = envRef.current;
    const depth = settingsBrowserDepthRef.current;
    settingsBrowserDepthRef.current = 0;
    providerDetailPushedRef.current = false;
    if (n === null && depth === 1) {
      r.back();
      return;
    }
    r.replace(target);
  });

  const exitSettings = useStableCallback(() => {
    const { state: next, target } = exitSettingsState(getState());
    if (target === null) {
      return;
    }
    commitState(next);
    leaveSettings(target);
  });

  const goBack = useStableCallback(() => {
    const prev = getState();
    const { state: next, target } = stepBack(prev);
    if (target === null) {
      return;
    }
    commitState(next);

    const { router: r, native: n } = envRef.current;
    if (n !== null) {
      r.replace(target);
      return;
    }
    if (prev.settingsStack !== null && prev.settingsStack.length > 1) {
      const pushed = providerDetailPushedRef.current;
      providerDetailPushedRef.current = false;
      settingsBrowserDepthRef.current = Math.max(
        0,
        settingsBrowserDepthRef.current - 1,
      );
      if (pushed) {
        r.back();
        return;
      }
      r.replace(target);
      return;
    }
    if (prev.settingsStack !== null && prev.settingsStack.length === 1) {
      leaveSettings(target);
      return;
    }
    r.replace(target);
  });

  const handleNativeBack = useStableCallback(() => {
    if (dismissTopOverlay()) {
      return;
    }
    goBack();
  });

  const purgeDeletedTopic = useStableCallback(
    (topicId: string, fallbackHref?: string) => {
      const prev = getState();
      const next = purgeTopicState(prev, topicId, fallbackHref ?? "/");
      commitState(next);
      if (currentPath(next) !== currentPath(prev)) {
        envRef.current.router.replace(currentPath(next));
      }
    },
  );

  const purgeDeletedAssistant = useStableCallback((assistantId: string) => {
    const prev = getState();
    const next = purgeAssistantState(prev, assistantId);
    commitState(next);
    if (currentPath(next) !== currentPath(prev)) {
      envRef.current.router.replace(currentPath(next));
    }
  });

  const openAuthPage = useStableCallback(
    (path: string, options?: { refresh?: boolean }) => {
      commitState(syncPathname(getState(), path));
      const { router: r, native: n } = envRef.current;
      r[n !== null || isAuthRootPath(path) ? "replace" : "push"](path);
      if (options?.refresh) {
        r.refresh();
      }
    },
  );

  const completeAuth = useStableCallback(() => {
    commitState(openHomeState());
    settingsBrowserDepthRef.current = 0;
    providerDetailPushedRef.current = false;
    envRef.current.router.replace("/");
    envRef.current.router.refresh();
  });

  // Subscribe to native Back events and DOM overlay mutations when running
  // inside a shell that exposes `window.pikaNative.navigation`.
  useEffect(() => {
    const navBridge = native?.navigation;
    if (!navBridge) {
      return;
    }
    overlayOpenRef.current = hasOpenOverlay();
    syncNativeCanGoBack();

    const unsubscribeOverlay = observeOpenOverlay((open) => {
      overlayOpenRef.current = open;
      syncNativeCanGoBack();
    });
    const unsubscribeBack = navBridge.onBack(handleNativeBack);

    return () => {
      unsubscribeBack();
      unsubscribeOverlay();
      lastReportedCanGoBackRef.current = null;
    };
  }, [native, handleNativeBack, syncNativeCanGoBack]);

  const api = useMemo<AppNavigation>(
    () => ({
      navigateHome,
      openAssistant,
      openTopic,
      recordPromotedTopic,
      openSettings,
      openProviderDetail,
      exitSettings,
      goBack,
      purgeDeletedTopic,
      purgeDeletedAssistant,
      openAuthPage,
      completeAuth,
    }),
    [
      navigateHome,
      openAssistant,
      openTopic,
      recordPromotedTopic,
      openSettings,
      openProviderDetail,
      exitSettings,
      goBack,
      purgeDeletedTopic,
      purgeDeletedAssistant,
      openAuthPage,
      completeAuth,
    ],
  );

  return (
    <NavigationContext.Provider value={api}>
      {children}
    </NavigationContext.Provider>
  );
}
