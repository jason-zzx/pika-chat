"use client";

import type { ToolUIPart } from "ai";
import {
  CheckIcon,
  CircleAlertIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { incompleteState } from "./tool-part";

type ToolCallShellProps = {
  part: ToolUIPart;
  /** True while this message is still streaming. A persisted incomplete
   * tool part (stream interrupted between tool call and output) is NOT
   * running — without this hint it would spin forever on history reload. */
  streaming?: boolean;
  /** The parsed tool output (undefined when unavailable or unparseable).
   * An object carrying an `error` key counts as a failed call. */
  output: unknown;
  errorText: string | undefined;
  labels: { running: string; interrupted: string; done: string };
  /** "button" wraps the whole header row in one toggle button.
   * "overlay" places an absolute full-row toggle button under a
   * pointer-events-none content row, so tapping anywhere toggles
   * expand/collapse except row content that re-enables pointer events
   * (e.g. a title that opens a dialog). No nested interactive elements. */
  headerMode: "button" | "overlay";
  /** Overlay mode only: accessible name of the full-row toggle. */
  toggleAriaLabel?: string;
  /** Header content between the status label and the chevron. */
  middle?: ReactNode;
  /** Rendered after the collapse container (e.g. a portaled dialog). */
  footer?: ReactNode;
  /** The collapsible body. */
  children: ReactNode;
};

/**
 * Shared collapsible shell for tool call blocks (search, fetch): status
 * icon + label header, grid-rows collapse container, and the
 * running/interrupted/failed derivation from the part and its output.
 */
export default function ToolCallShell({
  part,
  streaming = false,
  output,
  errorText,
  labels,
  headerMode,
  toggleAriaLabel,
  middle,
  footer,
  children,
}: ToolCallShellProps) {
  const contentId = useId();
  const incomplete = incompleteState(part);
  const running = incomplete && streaming;
  const interrupted = incomplete && !streaming;
  // Expanded while running; auto-collapses once the output lands. A manual
  // toggle wins over the automatic state (same pattern as ReasoningBlock).
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? running;
  const failed =
    errorText !== undefined ||
    (typeof output === "object" && output !== null && "error" in output);

  const icon = running ? (
    <LoaderCircleIcon
      aria-hidden="true"
      className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
    />
  ) : failed ? (
    <CircleAlertIcon
      aria-hidden="true"
      className="size-4 shrink-0 text-destructive"
    />
  ) : interrupted ? (
    <CircleAlertIcon
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
    />
  ) : (
    <CheckIcon
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
    />
  );

  const label = running
    ? labels.running
    : interrupted
      ? labels.interrupted
      : labels.done;

  const chevron = (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
        open ? "rotate-180" : "rotate-0",
      )}
    />
  );

  const toggle = () => setUserOpen(!open);

  return (
    <div className="w-full rounded-lg border border-border bg-muted/40 text-sm">
      {headerMode === "button" ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
        >
          {icon}
          <span className="shrink-0 font-medium">{label}</span>
          {middle}
          {chevron}
        </button>
      ) : (
        <div className="relative">
          <button
            type="button"
            className="absolute inset-0 rounded-t-lg hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-expanded={open}
            aria-controls={contentId}
            aria-label={toggleAriaLabel}
            onClick={toggle}
          />
          <div className="pointer-events-none relative flex items-center gap-2 px-3 py-2">
            {icon}
            <span className="shrink-0 font-medium">{label}</span>
            {middle}
            {chevron}
          </div>
        </div>
      )}
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
          <div className="border-t border-border px-3 py-2">{children}</div>
        </div>
      </div>
      {footer}
    </div>
  );
}
