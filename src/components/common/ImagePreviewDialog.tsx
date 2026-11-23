"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PencilIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { SharedTooltip } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/clipboard";

const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2;
const TAP_MAX_MOVE = 8;
const DOUBLE_TAP_DELAY_MS = 300;
const DOUBLE_TAP_MAX_DISTANCE = 32;

type Point = { x: number; y: number };
type ZoomAnchor = { u: number; v: number; clientX: number; clientY: number };
type BaseSize = { width: number; height: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPinchMetrics(pointers: Map<number, Point>) {
  const iterator = pointers.values();
  const p1 = iterator.next().value;
  const p2 = iterator.next().value;
  if (!p1 || !p2) {
    return null;
  }
  return {
    distance: Math.hypot(p2.x - p1.x, p2.y - p1.y),
    midX: (p1.x + p2.x) / 2,
    midY: (p1.y + p2.y) / 2,
  };
}

function measureAnchor(
  img: HTMLImageElement | null,
  clientX: number,
  clientY: number,
): ZoomAnchor {
  const rect = img?.getBoundingClientRect();
  return {
    u:
      rect && rect.width > 0
        ? clamp((clientX - rect.left) / rect.width, 0, 1)
        : 0.5,
    v:
      rect && rect.height > 0
        ? clamp((clientY - rect.top) / rect.height, 0, 1)
        : 0.5,
    clientX,
    clientY,
  };
}

function applyZoomAnchor(
  container: HTMLDivElement,
  baseSize: BaseSize | null,
  scale: number,
  anchor: ZoomAnchor,
) {
  if (!baseSize) {
    return;
  }
  if (scale <= 1) {
    container.scrollLeft = 0;
    container.scrollTop = 0;
    return;
  }
  const rect = container.getBoundingClientRect();
  container.scrollLeft = Math.max(
    0,
    anchor.u * baseSize.width * scale - (anchor.clientX - rect.left),
  );
  container.scrollTop = Math.max(
    0,
    anchor.v * baseSize.height * scale - (anchor.clientY - rect.top),
  );
}
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
  /** "Edit this image" (chat messages only): stage the file as a composer
   * reference. The file manager does not pass it. */
  onEdit?: () => void;
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
  onEdit,
}: ImagePreviewDialogProps) {
  const t = useTranslations("ImagePreview");
  const tFiles = useTranslations("Files");
  const tCommon = useTranslations("Common");
  const [baseSize, setBaseSize] = useState<BaseSize | null>(null);
  const [scale, setScale] = useState(1);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const scaleRef = useRef(1);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const dragOrigin = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const pinchOrigin = useRef<{
    startDistance: number;
    startScale: number;
    anchorU: number;
    anchorV: number;
  } | null>(null);
  const wasPinchingRef = useRef(false);
  const pendingAnchorRef = useRef<ZoomAnchor | null>(null);
  const tapCandidateRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );

  const hasNavigation = onPrev !== undefined && onNext !== undefined;

  useLayoutEffect(() => {
    scaleRef.current = scale;
    const container = scrollRef.current;
    const anchor = pendingAnchorRef.current;
    if (!container || !anchor) {
      return;
    }
    pendingAnchorRef.current = null;
    applyZoomAnchor(container, baseSize, scale, anchor);
  }, [scale, baseSize]);

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

  function setZoom(next: number, anchor: ZoomAnchor | null = null) {
    pendingAnchorRef.current = anchor;
    scaleRef.current = next;
    setScale(next);
  }

  const zoom = (direction: 1 | -1) =>
    setZoom(
      clamp(
        scaleRef.current * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP),
        MIN_SCALE,
        MAX_SCALE,
      ),
    );

  function initPinch(pointers: Map<number, Point>) {
    const metrics = getPinchMetrics(pointers);
    if (!metrics) {
      return;
    }
    const anchor = measureAnchor(imgRef.current, metrics.midX, metrics.midY);
    pinchOrigin.current = {
      startDistance: metrics.distance,
      startScale: scaleRef.current,
      anchorU: anchor.u,
      anchorV: anchor.v,
    };
  }

  // Pointer gestures: single pointer drags to pan (and detects double-tap),
  // two pointers pinch-zoom around their midpoint. Pointer capture keeps
  // the gesture routed to the scroll container across element bounds.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const container = scrollRef.current;
    if ((event.pointerType !== "touch" && event.button !== 0) || !container) {
      return;
    }
    event.preventDefault();

    const pointerId = event.pointerId ?? 0;
    pointersRef.current.set(pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    container.setPointerCapture?.(pointerId);

    if (pointersRef.current.size === 1) {
      dragOrigin.current = {
        x: event.clientX,
        y: event.clientY,
        left: container.scrollLeft,
        top: container.scrollTop,
      };
      tapCandidateRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      };
      return;
    }

    dragOrigin.current = null;
    tapCandidateRef.current = null;
    lastTapRef.current = null;
    wasPinchingRef.current = true;
    if (pointersRef.current.size === 2) {
      initPinch(pointersRef.current);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const container = scrollRef.current;
    const pointerId = event.pointerId ?? 0;
    if (!container || !pointersRef.current.has(pointerId)) {
      return;
    }
    pointersRef.current.set(pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size >= 2 && pinchOrigin.current) {
      const metrics = getPinchMetrics(pointersRef.current);
      if (
        !metrics ||
        metrics.distance <= 0 ||
        pinchOrigin.current.startDistance <= 0
      ) {
        return;
      }
      const nextScale = clamp(
        pinchOrigin.current.startScale *
          (metrics.distance / pinchOrigin.current.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      const anchor: ZoomAnchor = {
        u: pinchOrigin.current.anchorU,
        v: pinchOrigin.current.anchorV,
        clientX: metrics.midX,
        clientY: metrics.midY,
      };
      if (nextScale === scaleRef.current) {
        applyZoomAnchor(container, baseSize, nextScale, anchor);
        return;
      }
      setZoom(nextScale, anchor);
      return;
    }

    const origin = dragOrigin.current;
    if (!origin) {
      return;
    }
    const tap = tapCandidateRef.current;
    if (
      tap &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_MAX_MOVE
    ) {
      tapCandidateRef.current = null;
    }
    container.scrollLeft = origin.left - (event.clientX - origin.x);
    container.scrollTop = origin.top - (event.clientY - origin.y);
  }

  function releasePointer(
    event: PointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) {
    const container = scrollRef.current;
    const pointerId = event.pointerId ?? 0;
    if (!pointersRef.current.has(pointerId)) {
      return;
    }
    pointersRef.current.delete(pointerId);

    const remaining = pointersRef.current;
    if (remaining.size >= 2) {
      initPinch(remaining);
      return;
    }
    pinchOrigin.current = null;

    if (remaining.size === 1) {
      const point = remaining.values().next().value;
      dragOrigin.current =
        container && point
          ? {
              x: point.x,
              y: point.y,
              left: container.scrollLeft,
              top: container.scrollTop,
            }
          : null;
      return;
    }

    dragOrigin.current = null;
    const wasPinching = wasPinchingRef.current;
    wasPinchingRef.current = false;

    if (wasPinching) {
      tapCandidateRef.current = null;
      if (scaleRef.current < 1) {
        setZoom(1, { u: 0.5, v: 0.5, clientX: 0, clientY: 0 });
      }
      return;
    }

    const tap = tapCandidateRef.current;
    tapCandidateRef.current = null;
    if (cancelled || !tap) {
      lastTapRef.current = null;
      return;
    }

    const lastTap = lastTapRef.current;
    if (
      lastTap &&
      tap.time - lastTap.time <= DOUBLE_TAP_DELAY_MS &&
      Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) <=
        DOUBLE_TAP_MAX_DISTANCE
    ) {
      lastTapRef.current = null;
      if (!baseSize) {
        return;
      }
      const targetScale =
        Math.abs(scaleRef.current - 1) > 0.05 ? 1 : DOUBLE_TAP_SCALE;
      setZoom(targetScale, measureAnchor(imgRef.current, tap.x, tap.y));
      return;
    }

    lastTapRef.current = tap;
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
        <DialogOverlay className="touch-none overscroll-none" />
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex h-dvh w-full touch-none overscroll-none flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-sm text-foreground outline-none">
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
                onClick={() => setZoom(1)}
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
              {onEdit ? (
                <SharedTooltip
                  payload={tFiles("editImage")}
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tFiles("editImage")}
                      onClick={onEdit}
                    />
                  }
                >
                  <PencilIcon aria-hidden="true" />
                </SharedTooltip>
              ) : null}
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
            className="flex flex-1 cursor-grab touch-none overscroll-none overflow-auto select-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => releasePointer(event, false)}
            onPointerCancel={(event) => releasePointer(event, true)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin authenticated GET; next/image's optimizer does not carry the user's session cookie */}
            <img
              ref={imgRef}
              src={src}
              alt={filename}
              draggable={false}
              onLoad={(event) =>
                setBaseSize({
                  width: event.currentTarget.offsetWidth,
                  height: event.currentTarget.offsetHeight,
                })
              }
              style={
                baseSize !== null ? { width: baseSize.width * scale } : undefined
              }
              className={
                baseSize !== null
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
