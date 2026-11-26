import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toast";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import DesktopSettingsSection from "./DesktopSettingsSection";

function stubDesktop(overrides: Partial<PikaNativeDesktop> = {}): PikaNativeDesktop {
  return {
    platform: "win32",
    getSettings: vi.fn().mockResolvedValue({
      closeAction: "tray",
      hotkey: "CommandOrControl+Shift+Space",
      notificationsEnabled: true,
      developerMode: false,
    }),
    setCloseAction: vi.fn().mockResolvedValue(undefined),
    setNotificationsEnabled: vi.fn().mockResolvedValue(undefined),
    setHotkey: vi.fn().mockResolvedValue({ ok: true }),
    getStorageUsage: vi.fn().mockResolvedValue({
      localDataBytes: 2048,
      webCacheBytes: 1048576,
      updaterCacheBytes: 0,
      logsAndTempBytes: 512,
    }),
    clearStorage: vi.fn().mockResolvedValue({
      localDataBytes: 2048,
      webCacheBytes: 0,
      updaterCacheBytes: 0,
      logsAndTempBytes: 512,
    }),
    openLocalDataFolder: vi.fn().mockResolvedValue(undefined),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    openDevTools: vi.fn().mockResolvedValue(undefined),
    openDesktopLog: vi.fn().mockResolvedValue(undefined),
    setDeveloperMode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("DesktopSettingsSection", () => {
  afterEach(() => {
    delete window.pikaNative;
    vi.restoreAllMocks();
  });

  it("renders nothing in browsers or shells without desktop capabilities", () => {
    const { container } = renderWithIntl(<DesktopSettingsSection />);
    expect(container).toBeEmptyDOMElement();

    window.pikaNative = {
      serverName: "Home",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
    };
    const { container: c2 } = renderWithIntl(<DesktopSettingsSection />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("loads desktop settings and storage breakdown and allows clearing cache", async () => {
    const desktop = stubDesktop();
    window.pikaNative = {
      serverName: "Home",
      appVersion: "1.0.0-rc.2",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      desktop,
    };

    renderWithIntl(
      <>
        <DesktopSettingsSection />
        <Toaster />
      </>,
    );

    expect(await screen.findByText("When closing window")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+Space")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();

    const [clearWebCache, clearUpdaterCache] = screen.getAllByRole("button", {
      name: "Clear cache",
    });
    if (!clearWebCache || !clearUpdaterCache) {
      throw new Error("Expected Clear cache buttons");
    }
    expect(clearUpdaterCache).toBeDisabled();
    fireEvent.click(clearWebCache);
    await waitFor(() => {
      expect(desktop.clearStorage).toHaveBeenCalledWith("webCache");
      expect(screen.getByText("Cleared")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(desktop.openLocalDataFolder).toHaveBeenCalled();

    const [clearHotkey, clearLogs] = screen.getAllByRole("button", {
      name: "Clear",
    });
    if (!clearHotkey || !clearLogs) {
      throw new Error("Expected Clear buttons");
    }
    fireEvent.click(clearHotkey);
    expect(desktop.setHotkey).toHaveBeenCalledWith(null);

    fireEvent.click(clearLogs);
    await waitFor(() => {
      expect(desktop.clearStorage).toHaveBeenCalledWith("logsAndTemp");
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(desktop.getStorageUsage).toHaveBeenCalledTimes(2);
    });
  });

  it("records a global shortcut, cancels on Escape, and reports registration errors", async () => {
    const setHotkey = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });
    const desktop = stubDesktop({ setHotkey });
    window.pikaNative = {
      serverName: "Home",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      desktop,
    };

    renderWithIntl(
      <>
        <DesktopSettingsSection />
        <Toaster />
      </>,
    );

    const recorder = await screen.findByRole("button", { name: "Ctrl+Shift+Space" });

    fireEvent.click(recorder);
    expect(screen.getByText("Press a shortcut… (Esc to cancel)")).toBeInTheDocument();
    fireEvent.keyDown(recorder, { code: "Escape" });
    expect(screen.getByText("Ctrl+Shift+Space")).toBeInTheDocument();

    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { code: "KeyK", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(setHotkey).toHaveBeenCalledWith("CommandOrControl+Shift+K");
      expect(screen.getByText("Ctrl+Shift+K")).toBeInTheDocument();
    });

    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { code: "KeyJ", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("That shortcut is unavailable. Try another one.")).toBeInTheDocument();
      expect(screen.getByText("Ctrl+Shift+K")).toBeInTheDocument();
    });

    const trigger = screen.getByRole("combobox", { name: "When closing window" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const trayOption = await screen.findByRole("option", { name: "Minimize to tray" });
    await waitFor(() => expect(trayOption).toHaveFocus());
    fireEvent.keyDown(trayOption, { key: "ArrowDown" });
    const quitOption = screen.getByRole("option", { name: "Quit app" });
    await waitFor(() => expect(quitOption).toHaveFocus());
    fireEvent.keyDown(quitOption, { key: "Enter" });
    await waitFor(() => {
      expect(desktop.setCloseAction).toHaveBeenCalledWith("quit");
    });
  });

  it("hides close-window behavior on macOS", async () => {
    const desktop = stubDesktop({ platform: "darwin" });
    window.pikaNative = {
      serverName: "Home",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      desktop,
    };

    renderWithIntl(<DesktopSettingsSection />);

    expect(await screen.findByText("Cmd+Shift+Space")).toBeInTheDocument();
    expect(screen.queryByText("When closing window")).toBeNull();
  });

  it("toggles desktop reply notifications and hides the switch on older shells", async () => {
    const desktop = stubDesktop();
    window.pikaNative = {
      serverName: "Home",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      desktop,
    };

    const { unmount } = renderWithIntl(<DesktopSettingsSection />);

    const toggle = await screen.findByRole("switch", {
      name: "Reply notifications",
    });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(desktop.setNotificationsEnabled).toHaveBeenCalledWith(false);
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(desktop.setNotificationsEnabled).toHaveBeenCalledWith(true);
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });

    unmount();

    window.pikaNative = {
      serverName: "Home",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
      desktop: stubDesktop({ setNotificationsEnabled: undefined }),
    };
    renderWithIntl(<DesktopSettingsSection />);
    expect(await screen.findByText("Ctrl+Shift+Space")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Reply notifications" })).toBeNull();
  });
});
