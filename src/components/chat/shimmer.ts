/**
 * Gradient shimmer text shared by the "Thinking…" indicator, the in-flight
 * translation placeholder, and the in-flight compression notice. Callers add
 * only their display/size classes (`inline-block`, `shrink-0`, `text-xs`, …).
 */
export const SHIMMER_TEXT_CLASS =
  "animate-thinking-shimmer bg-linear-to-r from-muted-foreground/40 via-foreground to-muted-foreground/40 bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none";
