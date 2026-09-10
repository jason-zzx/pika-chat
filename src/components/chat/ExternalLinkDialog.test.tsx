import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "@/lib/clipboard";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import ExternalLinkDialog from "./ExternalLinkDialog";

vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

const copyMock = vi.mocked(copyTextToClipboard);

const URL = "https://pika.example.com/docs";
const LONG_URL = `https://pika.example.com/${"a".repeat(120)}`;

afterEach(() => {
  vi.restoreAllMocks();
  copyMock.mockReset();
});

function renderDialog(url = URL) {
  const onOpenChange = vi.fn();
  renderWithIntl(<ExternalLinkDialog url={url} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

async function findDialog() {
  return screen.findByRole("alertdialog");
}

describe("ExternalLinkDialog", () => {
  it("shows the title, warning, and URL in a mono box", async () => {
    renderDialog();

    const dialog = await findDialog();
    expect(dialog).toHaveTextContent("Open external link?");
    expect(dialog).toHaveTextContent(
      "You're about to visit an external website.",
    );
    const urlBox = within(dialog).getByText(URL);
    expect(urlBox).toHaveClass("font-mono");
    expect(urlBox).toHaveClass("break-all");
    // A short URL gets no scroll clamp.
    expect(urlBox).not.toHaveClass("max-h-32");
  });

  it("clamps long URLs with a scrollable box", async () => {
    renderDialog(LONG_URL);

    const dialog = await findDialog();
    const urlBox = within(dialog).getByText(LONG_URL);
    expect(urlBox).toHaveClass("max-h-32", "overflow-y-auto");
  });

  it("closes via the X button without navigating", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const onOpenChange = renderDialog();

    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    // Base UI passes an event-details object as the second argument.
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("copies the link and switches to Copied feedback", async () => {
    copyMock.mockResolvedValue(true);
    renderDialog();

    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy link" }));

    expect(copyMock).toHaveBeenCalledWith(URL);
    await within(dialog).findByRole("button", { name: "Copied" });
  });

  it("does not show Copied feedback when copying fails", async () => {
    copyMock.mockResolvedValue(false);
    renderDialog();

    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy link" }));

    expect(copyMock).toHaveBeenCalledWith(URL);
    // Give the async handler a tick to settle.
    await waitFor(() => expect(copyMock).toHaveReturned());
    expect(
      within(dialog).queryByRole("button", { name: "Copied" }),
    ).not.toBeInTheDocument();
  });

  it("resets copy feedback across a close and reopen cycle", async () => {
    copyMock.mockResolvedValue(true);
    const onOpenChange = vi.fn();
    const { rerender } = renderWithIntl(
      <ExternalLinkDialog url={URL} open onOpenChange={onOpenChange} />,
    );

    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy link" }));
    await within(dialog).findByRole("button", { name: "Copied" });

    rerender(
      wrapWithIntl(
        <ExternalLinkDialog url={URL} open={false} onOpenChange={onOpenChange} />,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );

    rerender(
      wrapWithIntl(
        <ExternalLinkDialog url={URL} open onOpenChange={onOpenChange} />,
      ),
    );
    const reopened = await findDialog();
    expect(
      within(reopened).getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
    expect(
      within(reopened).queryByRole("button", { name: "Copied" }),
    ).not.toBeInTheDocument();
  });

  it("closes when clicking the backdrop without navigating", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const onOpenChange = renderDialog();

    await findDialog();
    const backdrop = document.querySelector(
      '[data-slot="alert-dialog-overlay"]',
    );
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("opens the URL in a new tab on Open link and closes", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const onOpenChange = renderDialog();

    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open link" }));

    expect(openSpy).toHaveBeenCalledWith(URL, "_blank", "noreferrer");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
