"use client";

import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { ChatMetadata } from "@/lib/schemas/chat";

const COPY_RESET_MS = 2_000;

type CopyState = "idle" | "success" | "failed";

const COPY_STATE_TITLE: Record<CopyState, string> = {
  idle: "Copy message",
  success: "Copied",
  failed: "Copy failed",
};

/**
 * Derived from ChatMetadata so the component contract can never drift from
 * the schema. `versionIndex` is the 1-based position of the shown version
 * within its group; `versionIds` lists all version ids in the group, oldest
 * first.
 */
export type MessageVersionInfo = Required<
  Pick<ChatMetadata, "versionIndex" | "versionCount" | "versionIds">
>;

type MessageActionsProps = {
  text: string;
  messageRole: "user" | "assistant";
  version?: MessageVersionInfo;
  onSelectVersion?: (versionId: string) => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  /** Assistant-only menu item: delete the shown version, then regenerate. */
  onDeleteRegenerate?: () => void;
  /** Menu open state, lifted so the parent can keep the actions row visible
   * while the portaled menu has focus (B2). */
  onMenuOpenChange?: (open: boolean) => void;
  /** True while the transient copy feedback (check icon) is showing, so the
   * parent can keep the row visible for the whole feedback window (B4). */
  onCopyFeedbackChange?: (active: boolean) => void;
};

const ACTION_BUTTON_CLASS =
  "rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

export default function MessageActions({
  text,
  messageRole,
  version,
  onSelectVersion,
  onRegenerate,
  onDelete,
  onDeleteRegenerate,
  onMenuOpenChange,
  onCopyFeedbackChange,
}: MessageActionsProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimeoutRef = useRef<number | null>(null);

  const copyFeedbackActive = copyState !== "idle";
  useEffect(() => {
    onCopyFeedbackChange?.(copyFeedbackActive);
  }, [copyFeedbackActive, onCopyFeedbackChange]);

  async function handleCopy() {
    // B9: navigator.clipboard is unavailable on insecure contexts (http over
    // LAN); copyTextToClipboard falls back to execCommand there.
    const copied = await copyTextToClipboard(text);
    setCopyState(copied ? "success" : "failed");
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = window.setTimeout(() => {
      resetTimeoutRef.current = null;
      setCopyState("idle");
    }, COPY_RESET_MS);
  }

  const showVersionSwitcher =
    version !== undefined &&
    version.versionCount > 1 &&
    onSelectVersion !== undefined;
  const hasPrevious = version !== undefined && version.versionIndex > 1;
  const hasNext =
    version !== undefined && version.versionIndex < version.versionCount;

  return (
    <div className="flex h-5 shrink-0 items-center gap-1">
      {/* The version switcher is part of the same reveal group as the other
          actions (R9): hidden until hover/focus/tap, not always visible. */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/message:opacity-100 group-focus-within/message:opacity-100 group-data-[revealed=true]/message:opacity-100">
        {showVersionSwitcher && version ? (
          <div
            className="flex items-center gap-0.5"
            role="group"
            aria-label={`Version ${version.versionIndex} of ${version.versionCount}`}
          >
            <button
              type="button"
              aria-label="Previous version"
              title="Previous version"
              disabled={!hasPrevious}
              onClick={() => {
                const target = version.versionIds[version.versionIndex - 2];
                if (target !== undefined) {
                  onSelectVersion(target);
                }
              }}
              className={ACTION_BUTTON_CLASS}
            >
              <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
            </button>
            <span
              className="min-w-7 text-center text-xs text-muted-foreground tabular-nums"
              aria-hidden="true"
            >
              {version.versionIndex}/{version.versionCount}
            </span>
            <button
              type="button"
              aria-label="Next version"
              title="Next version"
              disabled={!hasNext}
              onClick={() => {
                const target = version.versionIds[version.versionIndex];
                if (target !== undefined) {
                  onSelectVersion(target);
                }
              }}
              className={ACTION_BUTTON_CLASS}
            >
              <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ) : null}
        {onRegenerate ? (
          <button
            type="button"
            aria-label="Regenerate response"
            title="Regenerate response"
            onClick={onRegenerate}
            className={ACTION_BUTTON_CLASS}
          >
            <RefreshCwIcon aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Copy message"
          title={COPY_STATE_TITLE[copyState]}
          onClick={() => {
            void handleCopy();
          }}
          className={ACTION_BUTTON_CLASS}
        >
          {copyState === "success" ? (
            <CheckIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <CopyIcon aria-hidden="true" className="size-3.5" />
          )}
        </button>
        <DropdownMenu onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More actions"
                title="More actions"
                className={ACTION_BUTTON_CLASS}
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-auto">
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                void handleCopy();
              }}
            >
              Copy
            </DropdownMenuItem>
            {onRegenerate ? (
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={onRegenerate}
              >
                Regenerate
              </DropdownMenuItem>
            ) : null}
            {messageRole === "assistant" && onDeleteRegenerate ? (
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={onDeleteRegenerate}
              >
                Delete and regenerate
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <DropdownMenuItem
                variant="destructive"
                className="whitespace-nowrap"
                onClick={onDelete}
              >
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="sr-only" aria-live="polite">
          {copyState === "success"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : ""}
        </span>
      </div>
    </div>
  );
}
