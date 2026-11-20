import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toast";
import * as clipboard from "@/lib/clipboard";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import AboutVersionCard from "./AboutVersionCard";

describe("AboutVersionCard", () => {
  afterEach(() => {
    delete window.pikaNative;
    vi.restoreAllMocks();
  });

  it("shows a single version and copies it in a browser", async () => {
    const copySpy = vi
      .spyOn(clipboard, "copyTextToClipboard")
      .mockResolvedValue(true);

    renderWithIntl(<AboutVersionCard version="1.0.0-rc.1" />);

    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0-rc.1")).toBeInTheDocument();
    expect(screen.queryByText("Client version")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy version" }));

    await waitFor(() => {
      expect(copySpy).toHaveBeenCalledWith("Pika Chat v1.0.0-rc.1");
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
  });

  it("shows server and client versions when running in a native shell remotely", async () => {
    const copySpy = vi
      .spyOn(clipboard, "copyTextToClipboard")
      .mockResolvedValue(true);
    window.pikaNative = {
      serverName: "Home lab",
      appVersion: "1.0.0-rc.2",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
    };

    renderWithIntl(<AboutVersionCard version="1.0.0-rc.1" />);

    expect(screen.getByText("Server version")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0-rc.1")).toBeInTheDocument();
    expect(screen.getByText("Client version")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0-rc.2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy version" }));

    await waitFor(() => {
      expect(copySpy).toHaveBeenCalledWith(
        "Pika Chat (server v1.0.0-rc.1, client v1.0.0-rc.2)",
      );
    });
  });

  it("falls back to a single version when an older native shell omits appVersion", () => {
    window.pikaNative = {
      serverName: "Home lab",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
    };

    renderWithIntl(<AboutVersionCard version="1.0.0-rc.1" />);

    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.queryByText("Client version")).toBeNull();
  });

  it("shows the local mode badge and hides duplicate client version in local mode", () => {
    window.pikaNative = {
      serverName: "This computer",
      appVersion: "1.0.0-rc.1",
      notify: vi.fn(),
      showServerMenu: vi.fn(),
      openServers: vi.fn(),
    };

    renderWithIntl(<AboutVersionCard version="1.0.0-rc.1" local />);

    expect(screen.getByText("Local mode")).toBeInTheDocument();
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.queryByText("Client version")).toBeNull();
  });

  it("shows the demo mode badge for guest sessions", () => {
    renderWithIntl(<AboutVersionCard version="1.0.0-rc.1" isGuest />);

    expect(screen.getByText("Demo mode")).toBeInTheDocument();
  });

  it("shows an error toast when copying fails", async () => {
    vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue(false);

    renderWithIntl(
      <>
        <AboutVersionCard version="1.0.0-rc.1" />
        <Toaster />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy version" }));

    expect(
      await screen.findByText("Could not copy version info"),
    ).toBeInTheDocument();
  });
});
