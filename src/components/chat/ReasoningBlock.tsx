"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type ReasoningBlockProps = {
  text: string;
  streaming: boolean;
  /** True once this thinking phase has ended — a later content block exists
   * or the stream finished. An ended phase collapses to its "Thought" label
   * (with its own duration when known) even while the turn keeps streaming. */
  ended: boolean;
  reasoningMs?: number;
};

// Distance from the bottom (px) within which the view still counts as
// pinned; beyond it the user scrolled up to read and must not be yanked
// back down.
const FOLLOW_THRESHOLD_PX = 24;

export default function ReasoningBlock({
  text,
  streaming,
  ended,
  reasoningMs,
}: ReasoningBlockProps) {
  const contentId = useId();
  // Open only while this block is the actively streaming phase; a finished
  // phase collapses as soon as the next step's content starts.
  const autoOpen = streaming && !ended;
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? autoOpen;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);

  // Re-arm following when a new stream starts or the block re-opens, so
  // the view pins to the latest output again.
  useEffect(() => {
    if (streaming || open) {
      followingRef.current = true;
    }
  }, [streaming, open]);

  // While the block is open and streaming, keep the newest output in view.
  // Instant assignment (no smooth scrolling) keeps motion-reduce safe.
  useEffect(() => {
    if (!open || !streaming || !followingRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text, open, streaming]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    followingRef.current = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
  }

  const label = !ended
    ? "Thinking"
    : reasoningMs === undefined
      ? "Thought"
      : `Thought (${(reasoningMs / 1000).toFixed(1)}s)`;

  return (
    <div className="w-full text-sm text-muted-foreground">
      <button
        type="button"
        className="-mx-1 flex w-full items-center justify-between gap-2 rounded-sm px-1 py-0.5 font-medium hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setUserOpen(!open)}
      >
        <span>{label}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      <div
        id={contentId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="thin-scrollbar mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap"
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
