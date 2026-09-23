"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { copyTextToClipboard } from "@/lib/clipboard";

const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
// Non-copy wire values; hoisted so the i18next guard does not read them as
// rendered copy.
const EXTERNAL_LINK_TARGET = "_blank";
const EXTERNAL_LINK_REL = "noreferrer noopener";

type ImagePreviewDialogProps = {
  src: string;
  filename: string;
  onOpenChange: (open: boolean) => void;
  /** Pass both (or neither) to enable prev/next navigation; the disabled
   * flags mark the ends of the parent's image list. */
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
};

/**
 * Full-viewport in-page image preview with zoom, drag-to-pan, copy, and
 * download. Built on the dialog primitives (focus trap, Esc, backdrop) but
 * renders its own full-screen popup rather than DialogContent's centered
 * card. The image fits the viewport at scale 1; zooming switches to an
 * explicit pixel width (measured at load) inside the scroll container, and
 * dragging pans it. Pass onPrev/onNext (file manager) to add navigation
 * with arrow-key support.
 */
export default function ImagePreviewDialog({
  src,
  filename,
  onOpenChange,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
}: ImagePreviewDialogProps) {
  const t = useTranslations("ImagePreview");
  const tCommon = useTranslations("Common");
  const [baseWidth, setBaseWidth] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  const hasNavigation = onPrev !== undefined && onNext !== undefined;

  useEffect(() => {
    if (!hasNavigation) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && !prevDisabled) {
        onPrev();
      } else if (event.key === "ArrowRight" && !nextDisabled) {
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasNavigation, onPrev, onNext, prevDisabled, nextDisabled]);

  const zoom = (direction: 1 | -1) =>
    setScale((previous) =>
      Math.min(
        MAX_SCALE,
        Math.max(
          MIN_SCALE,
          previous * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP),
        ),
      ),
    );

  // Drag-to-pan: pointer capture routes the whole gesture to the scroll
  // container, and panning is just offsetting scrollLeft/scrollTop.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const container = scrollRef.current;
    if (event.button !== 0 || !container) {
      return;
    }
    event.preventDefault();
    dragOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      left: container.scrollLeft,
      top: container.scrollTop,
    };
    container.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    const container = scrollRef.current;
    if (!origin || !container) {
      return;
    }
    container.scrollLeft = origin.left - (event.clientX - origin.x);
    container.scrollTop = origin.top - (event.clientY - origin.y);
  }

  function endDrag() {
    dragOrigin.current = null;
  }

  async function copyImage() {
    let ok = true;
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch {
      // Insecure contexts lack the async clipboard, and several browsers
      // only accept image/png there — fall back to the URL as text.
      ok = await copyTextToClipboard(
        new URL(src, window.location.origin).href,
      );
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex h-dvh w-full flex-col bg-background text-sm text-foreground outline-none">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <DialogPrimitive.Title className="truncate font-heading text-base font-medium">
              {filename}
            </DialogPrimitive.Title>
            <div className="flex shrink-0 items-center gap-1">
              {hasNavigation ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("previous")}
                    disabled={prevDisabled}
                    onClick={onPrev}
                  >
                    <ChevronLeftIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("next")}
                    disabled={nextDisabled}
                    onClick={onNext}
                  >
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("zoomOut")}
                onClick={() => zoom(-1)}
              >
                <ZoomOutIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("resetZoom")}
                className="w-12 tabular-nums"
                onClick={() => setScale(1)}
              >
                {Math.round(scale * 100)}%
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("zoomIn")}
                onClick={() => zoom(1)}
              >
                <ZoomInIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={copied ? t("copied") : t("copy")}
                onClick={() => void copyImage()}
              >
                {copied ? (
                  <CheckIcon aria-hidden="true" />
                ) : (
                  <CopyIcon aria-hidden="true" />
                )}
              </Button>
              {/* Download and open-in-new-tab stay plain anchors: the image
               * is same-origin (our authenticated /api/files route), so the
               * download attribute and target=_blank both work without
               * fetching bytes through JS. */}
              <a
                href={src}
                download={filename || true}
                aria-label={t("download")}
                className={buttonVariants({
                  variant: "ghost",
                  size: "icon-sm",
                })}
              >
                <DownloadIcon aria-hidden="true" />
              </a>
              <a
                href={src}
                target={EXTERNAL_LINK_TARGET}
                rel={EXTERNAL_LINK_REL}
                aria-label={t("openInNewTab")}
                className={buttonVariants({
                  variant: "ghost",
                  size: "icon-sm",
                })}
              >
                <ExternalLinkIcon aria-hidden="true" />
              </a>
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon aria-hidden="true" />
                <span className="sr-only">{tCommon("close")}</span>
              </DialogPrimitive.Close>
            </div>
          </div>
          {/* Flex + m-auto centers the image both axes without clipping when
           * it overflows (unlike justify-center, which eats the left edge
           * in a scroll container). */}
          <div
            ref={scrollRef}
            className="flex flex-1 cursor-grab touch-none overflow-auto select-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin authenticated GET; next/image's optimizer does not carry the user's session cookie */}
            <img
              src={src}
              alt={filename}
              draggable={false}
              onLoad={(event) =>
                setBaseWidth(event.currentTarget.offsetWidth)
              }
              style={
                baseWidth !== null ? { width: baseWidth * scale } : undefined
              }
              className={
                baseWidth !== null
                  ? // shrink-0: as a flex item the img would otherwise shrink
                    // back to the container width, silently capping any zoom
                    // past viewport width.
                    "m-auto h-auto max-w-none shrink-0 rounded-lg"
                  : "m-auto h-auto max-h-full w-auto max-w-full rounded-lg"
              }
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
