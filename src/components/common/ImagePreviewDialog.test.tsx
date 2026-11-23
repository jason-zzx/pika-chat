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

/** jsdom never loads images: fake the fitted dimensions and fire the load
 * event the component measures on. */
function loadImage(
  dialog: HTMLElement,
  fittedWidth = 800,
  fittedHeight = 600,
) {
  const image = within(dialog).getByRole("img", { name: "cat.png" });
  Object.defineProperty(image, "offsetWidth", {
    value: fittedWidth,
    configurable: true,
  });
  Object.defineProperty(image, "offsetHeight", {
    value: fittedHeight,
    configurable: true,
  });
  fireEvent.load(image);
  return image;
}

function mockBoxRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
    configurable: true,
  });
}

function touch(
  element: Element,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  fireEvent[type](element, {
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
  });
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
    // No onEdit: the edit entry stays out (file manager usage).
    expect(
      within(dialog).queryByRole("button", { name: "Edit this image" }),
    ).not.toBeInTheDocument();
  });

  it("renders an always-visible edit button when onEdit is provided", async () => {
    const onEdit = vi.fn();
    renderDialog({ onEdit });

    const dialog = await screen.findByRole("dialog");
    const edit = within(dialog).getByRole("button", {
      name: "Edit this image",
    });
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
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

    // Toolbar zoom-out clamps at 50% (MIN_SCALE = 0.5).
    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(within(dialog).getByRole("button", { name: "Zoom out" }));
    }
    expect(image).toHaveStyle({ width: "400px" });
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("50%");
  });

  it("pinch-zooms around the touch midpoint and keeps panning when one finger lifts", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const image = loadImage(dialog, 400, 300);
    const container = image.parentElement!;
    mockBoxRect(container, { left: 0, top: 0, width: 400, height: 400 });
    mockBoxRect(image, { left: 0, top: 50, width: 400, height: 300 });

    touch(container, "pointerDown", 1, 150, 200);
    touch(container, "pointerDown", 2, 250, 200);
    touch(container, "pointerMove", 1, 100, 200);
    touch(container, "pointerMove", 2, 300, 200);

    expect(image).toHaveStyle({ width: "800px" });
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("200%");
    expect(container.scrollLeft).toBe(200);
    expect(container.scrollTop).toBe(100);

    // Lifting one finger re-anchors single-finger pan to the remaining pointer.
    touch(container, "pointerUp", 2, 300, 200);
    touch(container, "pointerMove", 1, 80, 190);
    expect(container.scrollLeft).toBe(220);
    expect(container.scrollTop).toBe(110);

    touch(container, "pointerUp", 1, 80, 190);
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("200%");
  });

  it("allows pinching down to 50% and rebounds to 100% on release", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const image = loadImage(dialog, 400, 300);
    const container = image.parentElement!;
    mockBoxRect(container, { left: 0, top: 0, width: 400, height: 400 });
    mockBoxRect(image, { left: 0, top: 50, width: 400, height: 300 });

    touch(container, "pointerDown", 1, 100, 200);
    touch(container, "pointerDown", 2, 300, 200);
    touch(container, "pointerMove", 1, 190, 200);
    touch(container, "pointerMove", 2, 210, 200);

    expect(image).toHaveStyle({ width: "200px" });
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("50%");

    touch(container, "pointerUp", 1, 190, 200);
    touch(container, "pointerUp", 2, 210, 200);

    expect(image).toHaveStyle({ width: "400px" });
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("100%");
  });

  it("double-taps to zoom to 200% at the tap point and resets on a second double-tap", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const image = loadImage(dialog, 400, 300);
    const container = image.parentElement!;
    mockBoxRect(container, { left: 0, top: 0, width: 400, height: 400 });
    mockBoxRect(image, { left: 0, top: 50, width: 400, height: 300 });

    // First double-tap at (300, 200): u = 0.75, v = 0.5 -> zooms to 200%.
    touch(container, "pointerDown", 1, 300, 200);
    touch(container, "pointerUp", 1, 300, 200);
    touch(container, "pointerDown", 1, 300, 200);
    touch(container, "pointerUp", 1, 300, 200);

    expect(image).toHaveStyle({ width: "800px" });
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("200%");
    expect(container.scrollLeft).toBe(300);
    expect(container.scrollTop).toBe(100);

    // Second double-tap resets back to 100% and clears scroll offsets.
    touch(container, "pointerDown", 1, 300, 200);
    touch(container, "pointerUp", 1, 300, 200);
    touch(container, "pointerDown", 1, 300, 200);
    touch(container, "pointerUp", 1, 300, 200);

    expect(image).toHaveStyle({ width: "400px" });
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("100%");
    expect(container.scrollLeft).toBe(0);
    expect(container.scrollTop).toBe(0);

    // Dragging does not count as a tap toward double-tap zoom.
    touch(container, "pointerDown", 1, 200, 200);
    touch(container, "pointerMove", 1, 230, 200);
    touch(container, "pointerUp", 1, 230, 200);
    touch(container, "pointerDown", 1, 230, 200);
    touch(container, "pointerUp", 1, 230, 200);
    expect(
      within(dialog).getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("100%");
  });

  it("blocks browser touch zoom and scroll chaining on the preview surface", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const image = loadImage(dialog, 400, 300);
    const container = image.parentElement!;

    expect(dialog).toHaveClass("touch-none", "overscroll-none");
    expect(container).toHaveClass("touch-none", "overscroll-none");
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
