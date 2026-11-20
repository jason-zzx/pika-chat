"use client";

import { TextQuoteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type { ChatQuote } from "@/lib/schemas/chat";

import { quoteFromSelection } from "./quote-range";

/** Gap between the selection, the button, and the container edges. */
const GAP = 8;

/** Selection and container boxes; the button's top/left are resolved against
 * its rendered (size- and locale-dependent) box after it mounts. */
type Placement = {
  quote: ChatQuote;
  selection: DOMRect;
  bounds: DOMRect;
  touch: boolean;
};

type QuoteSelectionButtonProps = {
  /** The message scroll container: its visible box bounds the button. */
  containerRef: RefObject<HTMLDivElement | null>;
  onQuote: (quote: ChatQuote) => void;
};

/**
 * Floating "Quote" button for a text selection inside one message body.
 * Sits above the selection, or below when above falls outside the scroll
 * container's visible box (and always below on touch, where the native
 * selection menu takes the space above). Recomputed on selection change,
 * scroll, and resize so it follows the selection.
 */
export default function QuoteSelectionButton({
  containerRef,
  onQuote,
}: QuoteSelectionButtonProps) {
  const t = useTranslations("Chat.Quote");
  const [placement, setPlacement] = useState<Placement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const update = () => {
      const container = containerRef.current;
      const selection = window.getSelection();
      const quote =
        container && selection ? quoteFromSelection(selection, container) : null;
      if (!container || !selection || !quote) {
        setPlacement(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      // Scrolled fully out of view: nothing to anchor to.
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) {
        setPlacement(null);
        return;
      }
      setPlacement({
        quote,
        selection: rect,
        bounds,
        touch: window.matchMedia("(hover: none)").matches,
      });
    };
    document.addEventListener("selectionchange", update);
    // Capture: scroll does not bubble, and the container mounts later.
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button || !placement) {
      return;
    }
    const above = placement.selection.top - GAP - button.offsetHeight;
    const below = Math.min(
      placement.selection.bottom + GAP,
      placement.bounds.bottom - GAP - button.offsetHeight,
    );
    const half = button.offsetWidth / 2;
    const center = Math.min(
      Math.max(
        placement.selection.left + placement.selection.width / 2,
        placement.bounds.left + GAP + half,
      ),
      placement.bounds.right - GAP - half,
    );
    button.style.top = `${!placement.touch && above >= placement.bounds.top ? above : below}px`;
    button.style.left = `${center - half}px`;
  }, [placement]);

  if (!placement) {
    return null;
  }
  return createPortal(
    <Button
      ref={buttonRef}
      type="button"
      variant="secondary"
      size="sm"
      // Same `(hover: none)` query as the touch placement above.
      className="fixed z-50 shadow-md [@media(hover:none)]:h-9 [@media(hover:none)]:gap-1.5 [@media(hover:none)]:px-3 [@media(hover:none)]:text-base"
      // `top` / `left` are written by the layout effect above, before paint.
      // Keep the selection alive through the press; the stored quote is what
      // the click consumes either way.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onQuote(placement.quote);
        window.getSelection()?.removeAllRanges();
      }}
    >
      <TextQuoteIcon
        aria-hidden="true"
        className="size-3.5 [@media(hover:none)]:size-4.5"
      />
      {t("quote")}
    </Button>,
    document.body,
  );
}
