"use client";

import { ChevronDownIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CollapseBlockProps = {
  /**
   * Accessible name (also the tooltip) of the toggle. Receives the open state
   * so callers can swap wording between expand and collapse.
   */
  ariaLabel: (open: boolean) => string;
  /**
   * Toggle-button contents. Receives the rotating chevron and the open state
   * so each caller keeps its own layout (the translation block puts the chevron
   * after its language tag; the compression marker puts it inside the label).
   */
  label: (parts: { open: boolean; chevron: ReactNode }) => ReactNode;
  defaultOpen?: boolean;
  /** Outer container. */
  className?: string;
  /** The toggle button. */
  buttonClassName?: string;
  /** The chevron (size differs between callers). */
  chevronClassName?: string;
  /** Content wrapper inside the collapsing grid row. */
  contentClassName?: string;
  children: ReactNode;
};

/**
 * Chevron + `grid-rows-[1fr]/[0fr]` disclosure shared by the translation block
 * and the history-compression summary (no `ui/collapsible` primitive). The
 * collapsed panel is `aria-hidden` + `inert` so its content is neither
 * focusable nor announced; the toggle is a real button with
 * `aria-expanded`/`aria-controls`, reachable by touch and keyboard
 * (constraint #15).
 */
export default function CollapseBlock({
  ariaLabel,
  label,
  defaultOpen = false,
  className,
  buttonClassName,
  chevronClassName,
  contentClassName,
  children,
}: CollapseBlockProps) {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const name = ariaLabel(open);
  return (
    <div className={className}>
      <button
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={name}
        title={name}
        onClick={() => setOpen((current) => !current)}
      >
        {label({
          open,
          chevron: (
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open ? "rotate-180" : "rotate-0",
                chevronClassName,
              )}
            />
          ),
        })}
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
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    </div>
  );
}
