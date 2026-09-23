import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import ImagePreviewDialog from "./ImagePreviewDialog";

function renderDialog(props: Partial<ImagePreviewDialogProps> = {}) {
  return renderWithIntl(
    <ImagePreviewDialog
      src="/api/files/img-1"
      filename="cat.png"
      onOpenChange={vi.fn()}
      {...props}
    />,
  );
}

type ImagePreviewDialogProps = Parameters<typeof ImagePreviewDialog>[0];

/** jsdom never loads images: fake the fitted width and fire the load event
 * the component measures on. */
function loadImage(dialog: HTMLElement, fittedWidth = 800) {
  const image = within(dialog).getByRole("img", { name: "cat.png" });
  Object.defineProperty(image, "offsetWidth", {
    value: fittedWidth,
    configurable: true,
  });
  fireEvent.load(image);
  return image;
}

describe("ImagePreviewDialog", () => {
  it("renders the image with the zoom/copy/download toolbar", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "cat.png" }),
    ).toHaveAttribute("src", "/api/files/img-1");
    expect(
      within(dialog).getByRole("button", { name: "Zoom in" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Zoom out" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Copy image" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Download" }),
    ).toHaveAttribute("download", "cat.png");
    expect(
      within(dialog).getByRole("link", { name: "Open in new tab" }),
    ).toHaveAttribute("target", "_blank");
    // No navigation callbacks: no prev/next buttons.
    expect(
      within(dialog).queryByRole("button", { name: "Previous image" }),
    ).not.toBeInTheDocument();
  });

  it("zooms around the fitted width and resets to 100%", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const image = loadImage(dialog, 800);
    expect(image).toHaveStyle({ width: "800px" });
    // jsdom does no layout, so lock the class that keeps a zoomed image
    // from being flex-shrunk back to the container width.
    expect(image.className).toContain("shrink-0");

    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    expect(image).toHaveStyle({ width: "1000px" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom out" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom out" }));
    expect(image).toHaveStyle({ width: "640px" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset zoom" }));
    expect(image).toHaveStyle({ width: "800px" });
  });

  it("pans the image by dragging and stops on pointer up", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const image = loadImage(dialog, 800);
    const container = image.parentElement!;
    container.scrollLeft = 100;
    container.scrollTop = 50;

    fireEvent.pointerDown(container, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(container, { clientX: 150, clientY: 180 });
    // Dragging up-left by (50, 20) scrolls the container right-down by it.
    expect(container.scrollLeft).toBe(150);
    expect(container.scrollTop).toBe(70);

    fireEvent.pointerUp(container);
    fireEvent.pointerMove(container, { clientX: 0, clientY: 0 });
    expect(container.scrollLeft).toBe(150);
    expect(container.scrollTop).toBe(70);
  });

  it("navigates with buttons and arrow keys, disabled at the ends", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderDialog({ onPrev, onNext, prevDisabled: true });

    const dialog = await screen.findByRole("dialog");
    const prev = within(dialog).getByRole("button", { name: "Previous image" });
    const next = within(dialog).getByRole("button", { name: "Next image" });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(prev);
    expect(onPrev).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNext).toHaveBeenCalledTimes(2);
    // Disabled end swallows the arrow key too.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onPrev).not.toHaveBeenCalled();
  });
});
