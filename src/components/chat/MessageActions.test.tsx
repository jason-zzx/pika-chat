import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import MessageActions from "./MessageActions";

function mockClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function mockExecCommand(result: boolean) {
  const execCommand = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
  return execCommand;
}

const TWO_VERSIONS = {
  versionIndex: 1,
  versionCount: 2,
  versionIds: ["v1", "v2"],
};

describe("MessageActions", () => {
  it("reveals on hover, focus-within, and the tap-to-reveal data attribute", () => {
    const { container } = renderWithIntl(
      <MessageActions text="hello" messageRole="assistant" />,
    );

    const revealRow = container.querySelector("div.opacity-0");
    expect(revealRow).toHaveClass("group-hover/message:opacity-100");
    expect(revealRow).toHaveClass("group-focus-within/message:opacity-100");
    expect(revealRow).toHaveClass(
      "group-data-[revealed=true]/message:opacity-100",
    );
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    Reflect.deleteProperty(document, "execCommand");
  });

  it("copies the message text and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    renderWithIntl(<MessageActions text="hello world" messageRole="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello world");
    });
    expect(await screen.findByTitle("Copied")).toBeInTheDocument();
  });

  it("shows a transient failure title when both clipboard paths fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);
    mockExecCommand(false);
    renderWithIntl(<MessageActions text="hello" messageRole="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(await screen.findByTitle("Copy failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy message" })).toHaveAttribute(
      "aria-label",
      "Copy message",
    );
  });

  it("falls back to execCommand when the clipboard API is missing (B9)", async () => {
    mockClipboard(undefined);
    const execCommand = mockExecCommand(true);
    renderWithIntl(<MessageActions text="hello world" messageRole="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(await screen.findByTitle("Copied")).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when the clipboard API rejects (B9)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);
    const execCommand = mockExecCommand(true);
    renderWithIntl(<MessageActions text="hello world" messageRole="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(await screen.findByTitle("Copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("hello world");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("shows the version switcher for multi-version messages and selects the next version", () => {
    const onSelectVersion = vi.fn();
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        version={TWO_VERSIONS}
        onSelectVersion={onSelectVersion}
      />,
    );

    const switcher = screen.getByRole("group", { name: "Version 1 of 2" });
    expect(switcher).toHaveTextContent("1/2");
    // R9: the switcher shares the reveal row with the other actions instead
    // of being always visible.
    expect(switcher.closest("div.opacity-0")).toHaveClass(
      "group-data-[revealed=true]/message:opacity-100",
    );
    expect(
      screen.getByRole("button", { name: "Previous version" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next version" }));
    expect(onSelectVersion).toHaveBeenCalledWith("v2");
  });

  it("disables next at the last version and selects the previous version", () => {
    const onSelectVersion = vi.fn();
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        version={{ ...TWO_VERSIONS, versionIndex: 2 }}
        onSelectVersion={onSelectVersion}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Version 2 of 2" }),
    ).toHaveTextContent("2/2");
    expect(screen.getByRole("button", { name: "Next version" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous version" }));
    expect(onSelectVersion).toHaveBeenCalledWith("v1");
  });

  it("hides the version switcher for single-version messages", () => {
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        version={{ versionIndex: 1, versionCount: 1, versionIds: ["v1"] }}
        onSelectVersion={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Next version" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Previous version" }),
    ).not.toBeInTheDocument();
  });

  it("invokes regenerate from the toolbar button", () => {
    const onRegenerate = vi.fn();
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate response" }),
    );
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("lists copy, regenerate, delete-and-regenerate, and delete for assistant messages", async () => {
    const onDeleteRegenerate = vi.fn();
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        onRegenerate={vi.fn()}
        onDeleteRegenerate={onDeleteRegenerate}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(await screen.findByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete and regenerate" }),
    );
    expect(onDeleteRegenerate).toHaveBeenCalledTimes(1);
  });

  it("omits delete-and-regenerate from the user message menu", async () => {
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="user"
        onRegenerate={vi.fn()}
        onDeleteRegenerate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(await screen.findByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete and regenerate" }),
    ).not.toBeInTheDocument();
  });

  it("never wraps menu item labels (B3)", async () => {
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        onRegenerate={vi.fn()}
        onDeleteRegenerate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const item = await screen.findByRole("menuitem", {
      name: "Delete and regenerate",
    });
    expect(item).toHaveClass("whitespace-nowrap");
    for (const name of ["Copy", "Regenerate", "Delete"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveClass(
        "whitespace-nowrap",
      );
    }
  });

  it("reports menu open state so the parent can keep the row visible (B2)", async () => {
    const onMenuOpenChange = vi.fn();
    renderWithIntl(
      <MessageActions
        text="hello"
        messageRole="assistant"
        onDelete={vi.fn()}
        onMenuOpenChange={onMenuOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
    // Base UI calls onOpenChange(open, eventDetails); assert the open flag.
    expect(onMenuOpenChange.mock.calls.some(([open]) => open === true)).toBe(
      true,
    );
  });

  it("shows the check icon for two seconds after copying, then reverts (B4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    try {
      renderWithIntl(<MessageActions text="hello" messageRole="assistant" />);

      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

      await vi.waitFor(() => {
        expect(screen.getByTitle("Copied")).toBeInTheDocument();
      });
      expect(screen.queryByTitle("Copy message")).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(2_100);
      });

      expect(screen.getByTitle("Copy message")).toBeInTheDocument();
      expect(screen.queryByTitle("Copied")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports copy feedback activity while the check icon shows (B4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const onCopyFeedbackChange = vi.fn();
    try {
      renderWithIntl(
        <MessageActions
          text="hello"
          messageRole="assistant"
          onCopyFeedbackChange={onCopyFeedbackChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

      await vi.waitFor(() => {
        expect(onCopyFeedbackChange).toHaveBeenCalledWith(true);
      });

      await act(async () => {
        vi.advanceTimersByTime(2_100);
      });
      expect(onCopyFeedbackChange).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
