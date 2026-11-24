import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NAV_STATE_STORAGE_KEY } from "@/lib/navigation-state";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import NavigationProvider, {
  type AppNavigation,
  useAppNavigation,
} from "./NavigationProvider";

const mockEnv = vi.hoisted(() => ({
  pathname: "/",
  isMobile: false,
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockEnv.pathname,
  useRouter: () => ({
    push: mockEnv.push,
    replace: mockEnv.replace,
    back: mockEnv.back,
    refresh: mockEnv.refresh,
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockEnv.isMobile,
}));

function installNativeBridge() {
  const listeners = new Set<() => void>();
  const setCanGoBack = vi.fn();
  const onBack = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  window.pikaNative = {
    serverName: "Home",
    notify: vi.fn(),
    showServerMenu: vi.fn(),
    openServers: vi.fn(),
    navigation: { setCanGoBack, onBack },
  };
  return {
    setCanGoBack,
    triggerBack: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function Harness({
  onReady,
  withDialog = false,
}: {
  onReady: (nav: AppNavigation) => void;
  withDialog?: boolean;
}) {
  const nav = useAppNavigation();
  onReady(nav);
  const [open, setOpen] = useState(false);

  if (!withDialog) {
    return null;
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Modal</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

function renderNavigation(options?: { withDialog?: boolean }) {
  let current: AppNavigation | null = null;
  renderWithIntl(
    <NavigationProvider>
      <Harness
        onReady={(api) => {
          current = api;
        }}
        withDialog={options?.withDialog}
      />
    </NavigationProvider>,
  );
  if (current === null) {
    throw new Error("NavigationProvider did not provide AppNavigation");
  }
  return current as AppNavigation;
}

describe("NavigationProvider (native mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockEnv.pathname = "/";
    mockEnv.isMobile = false;
  });

  afterEach(() => {
    delete window.pikaNative;
  });

  it("reports initial canGoBack(false) at Home and treats root Back as a no-op", () => {
    const bridge = installNativeBridge();
    renderNavigation();

    expect(bridge.setCanGoBack).toHaveBeenCalledTimes(1);
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(false);

    act(() => bridge.triggerBack());
    expect(mockEnv.replace).not.toHaveBeenCalled();
    expect(mockEnv.push).not.toHaveBeenCalled();
  });

  it("routes native transitions via router.replace, forwards isMobile/query href, and steps Back via bridge", () => {
    const bridge = installNativeBridge();
    mockEnv.isMobile = true;
    const nav = renderNavigation();

    act(() => nav.openTopic("a1", "t1", "/assistant/a1/t1?m=grp_1"));
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/assistant/a1/t1?m=grp_1");
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(true);

    act(() => nav.openSettings("/settings/providers"));
    act(() => nav.openProviderDetail("cfg1"));
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/settings/providers/cfg1");

    act(() => bridge.triggerBack());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/settings/providers");

    act(() => nav.openProviderDetail("cfg1"));
    act(() => nav.exitSettings());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/assistant/a1/t1");

    act(() => bridge.triggerBack());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/");
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(false);
    expect(mockEnv.push).not.toHaveBeenCalled();
  });

  it("records promoted topics without calling router.replace while enabling Back to Home", () => {
    const bridge = installNativeBridge();
    const nav = renderNavigation();

    act(() => nav.recordPromotedTopic("a1", "t-new"));
    expect(mockEnv.replace).not.toHaveBeenCalled();
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(true);

    act(() => bridge.triggerBack());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/");
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(false);
  });

  it("consumes native Back to dismiss an open Dialog before route navigation and updates setCanGoBack", async () => {
    const bridge = installNativeBridge();
    renderNavigation({ withDialog: true });

    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Open modal" }));
    await waitFor(() =>
      expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(true),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => bridge.triggerBack());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(false),
    );
    expect(mockEnv.replace).not.toHaveBeenCalled();
  });

  it("wires openAuthPage refresh and completeAuth reset in native mode", () => {
    const bridge = installNativeBridge();
    mockEnv.pathname = "/sign-in";
    const nav = renderNavigation();

    act(() => nav.openAuthPage("/two-factor", { refresh: true }));
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/two-factor");
    expect(mockEnv.refresh).toHaveBeenCalledTimes(1);
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(true);

    act(() => nav.completeAuth());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/");
    expect(mockEnv.refresh).toHaveBeenCalledTimes(2);
    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(false);
    expect(mockEnv.push).not.toHaveBeenCalled();
  });

  it("restores logical stack from sessionStorage across manual reload", () => {
    const bridge = installNativeBridge();
    window.sessionStorage.setItem(
      NAV_STATE_STORAGE_KEY,
      JSON.stringify({
        mode: "app",
        workspaceStack: ["/", "/assistant/a1/t1", "/assistant/a1/t2"],
        settingsStack: null,
        authStack: [],
      }),
    );
    mockEnv.pathname = "/assistant/a1/t2";

    renderNavigation();

    expect(bridge.setCanGoBack).toHaveBeenLastCalledWith(true);
    act(() => bridge.triggerBack());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/assistant/a1/t1");
  });
});

describe("NavigationProvider (standalone browser mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    delete window.pikaNative;
    mockEnv.pathname = "/";
    mockEnv.isMobile = false;
  });

  it("uses push for topics and entering Settings, replace for Settings tabs, and router.back() to leave Settings", () => {
    const nav = renderNavigation();

    act(() => nav.openTopic("a1", "t1"));
    expect(mockEnv.push).toHaveBeenLastCalledWith("/assistant/a1/t1");

    act(() => nav.openSettings("/settings/general"));
    expect(mockEnv.push).toHaveBeenLastCalledWith("/settings/general");

    act(() => nav.openSettings("/settings/account"));
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/settings/account");

    act(() => nav.exitSettings());
    expect(mockEnv.back).toHaveBeenCalledTimes(1);
  });

  it("replaces instead of pushing when jumping out of Settings via SearchDialog", () => {
    const nav = renderNavigation();

    act(() => nav.openSettings("/settings/general"));
    mockEnv.push.mockClear();
    mockEnv.replace.mockClear();

    act(() => nav.openTopic("a1", "t3"));
    expect(mockEnv.replace).toHaveBeenCalledWith("/assistant/a1/t3");
    expect(mockEnv.push).not.toHaveBeenCalled();
  });

  it("falls back to replace('/') instead of router.back() when Settings was cold-loaded directly", () => {
    mockEnv.pathname = "/settings/general";
    const nav = renderNavigation();

    act(() => nav.exitSettings());
    expect(mockEnv.back).not.toHaveBeenCalled();
    expect(mockEnv.replace).toHaveBeenCalledWith("/");
  });

  it("uses router.replace on auth completion and topic deletion in browser mode", () => {
    mockEnv.pathname = "/sign-in";
    const nav = renderNavigation();

    act(() => nav.openAuthPage("/two-factor", { refresh: true }));
    expect(mockEnv.push).toHaveBeenLastCalledWith("/two-factor");

    act(() => nav.completeAuth());
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/");
    expect(mockEnv.refresh).toHaveBeenCalled();

    act(() => nav.openTopic("a1", "t1"));
    act(() => nav.purgeDeletedTopic("t1", "/assistant/a1"));
    expect(mockEnv.replace).toHaveBeenLastCalledWith("/assistant/a1");
  });
});
