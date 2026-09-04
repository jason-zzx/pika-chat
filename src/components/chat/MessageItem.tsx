"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { Streamdown } from "streamdown";

import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
} from "@/lib/schemas/assistant";
import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageActions from "./MessageActions";
import MessageTimestamp from "./MessageTimestamp";
import ReasoningBlock from "./ReasoningBlock";

type MessageItemProps = {
  message: ChatUIMessage;
  streaming?: boolean;
  assistantName?: string;
  assistantIcon?: string;
  /** Single-active tap reveal (R9/B7): owned by the parent list, which keeps
   * at most one message revealed. Undefined behaves as not revealed. */
  revealed?: boolean;
  /** The message body was tapped; the parent decides which message reveals. */
  onReveal?: () => void;
  onRegenerate?: (message: ChatUIMessage) => void;
  onDelete?: (message: ChatUIMessage) => void;
  onDeleteRegenerate?: (message: ChatUIMessage) => void;
  onSelectVersion?: (message: ChatUIMessage, versionId: string) => void;
};

export default function MessageItem({
  message,
  streaming = false,
  assistantName,
  assistantIcon,
  revealed = false,
  onReveal,
  onRegenerate,
  onDelete,
  onDeleteRegenerate,
  onSelectVersion,
}: MessageItemProps) {
  // Opening the dropdown moves focus into the portaled menu, dropping
  // hover/focus-within; keep the row visible while the menu is open (B2).
  const [menuOpen, setMenuOpen] = useState(false);
  // Keep the row visible for the whole copy-feedback window so the 2s check
  // icon is seen even when the pointer/focus has left the message (B4).
  const [copyFeedback, setCopyFeedback] = useState(false);
  const revealedAny = revealed || menuOpen || copyFeedback;
  const isUser = message.role === "user";
  const metadata = message.metadata;
  const outcome = metadata?.outcome;
  const modelId = metadata?.modelId;
  const createdAt = metadata?.createdAt;
  const reasoningMs = metadata?.reasoningMs;
  const textParts = message.parts.filter((part) => part.type === "text");
  const reasoningParts = message.parts.filter(
    (part) => part.type === "reasoning",
  );
  const reasoningText = reasoningParts.map((part) => part.text).join("");
  const hasAnswer = textParts.some((part) => part.text.length > 0);
  const showThinkingShimmer =
    streaming && textParts.length === 0 && reasoningParts.length === 0;
  const finishReason = metadata?.finishReason;
  const plainText = textParts.map((part) => part.text).join("");
  const versionIndex = metadata?.versionIndex;
  const versionCount = metadata?.versionCount;
  const versionIds = metadata?.versionIds;
  const version =
    versionIndex !== undefined &&
    versionCount !== undefined &&
    versionIds !== undefined
      ? { versionIndex, versionCount, versionIds }
      : undefined;

  function handleArticleClick(event: ReactMouseEvent<HTMLElement>) {
    // Buttons and links inside the message (actions, reasoning toggle,
    // streamdown copy buttons, anchors) handle their own clicks.
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, a")
    ) {
      return;
    }
    // Don't flicker the rows when the click was a text selection.
    if (window.getSelection()?.isCollapsed === false) {
      return;
    }
    // Single-active semantics (R9): a tap only ever reveals; it never hides.
    onReveal?.();
  }

  const actions = (
    <MessageActions
      text={plainText}
      messageRole={isUser ? "user" : "assistant"}
      version={version}
      onSelectVersion={
        onSelectVersion
          ? (versionId) => onSelectVersion(message, versionId)
          : undefined
      }
      onRegenerate={onRegenerate ? () => onRegenerate(message) : undefined}
      onDelete={onDelete ? () => onDelete(message) : undefined}
      onDeleteRegenerate={
        !isUser && onDeleteRegenerate
          ? () => onDeleteRegenerate(message)
          : undefined
      }
      onMenuOpenChange={setMenuOpen}
      onCopyFeedbackChange={setCopyFeedback}
    />
  );

  if (isUser) {
    return (
      <article
        className="group/message flex flex-col items-end gap-1"
        aria-label="You"
        data-revealed={revealedAny ? "true" : "false"}
        onClick={handleArticleClick}
      >
        <MessageTimestamp createdAt={createdAt} />
        <div className="max-w-[min(100%,42rem)] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {textParts.map((part, index) => (
            <p key={index} className="whitespace-pre-wrap">
              {part.text}
            </p>
          ))}
        </div>
        {actions}
      </article>
    );
  }

  return (
    <article
      className="group/message flex flex-col items-start gap-1"
      aria-label="Assistant"
      data-revealed={revealedAny ? "true" : "false"}
      onClick={handleArticleClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {assistantIcon ?? DEFAULT_ASSISTANT_ICON}{" "}
          {assistantName ?? DEFAULT_ASSISTANT_NAME}
        </span>
        <MessageTimestamp createdAt={createdAt} />
      </div>
      {reasoningParts.length > 0 ? (
        <ReasoningBlock
          text={reasoningText}
          streaming={streaming}
          hasAnswer={hasAnswer}
          reasoningMs={reasoningMs}
        />
      ) : null}
      <div className="w-full text-sm">
        {textParts.length === 0 ? (
          showThinkingShimmer ? (
            <span className="inline-block animate-thinking-shimmer bg-linear-to-r from-muted-foreground/40 via-foreground to-muted-foreground/40 bg-[length:200%_100%] bg-clip-text font-medium text-transparent motion-reduce:animate-none">
              Thinking…
            </span>
          ) : null
        ) : (
          textParts.map((part, index) => (
            <Streamdown key={index}>{part.text}</Streamdown>
          ))
        )}
      </div>
      {!streaming && !hasAnswer && finishReason === "length" ? (
        <p className="text-xs text-muted-foreground">
          Output stopped at the token limit.
        </p>
      ) : null}
      {!streaming &&
      !hasAnswer &&
      finishReason !== "length" &&
      reasoningParts.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          The model stopped before writing an answer.
        </p>
      ) : null}
      {outcome === "stopped" ? (
        <p className="text-xs text-muted-foreground">Stopped</p>
      ) : null}
      {outcome === "failed" ? (
        <p className="text-xs text-destructive" role="alert">
          {metadata?.errorMessage ?? "The model failed to respond."}
        </p>
      ) : null}
      {modelId ? (
        <p className="text-xs text-muted-foreground">{modelId}</p>
      ) : null}
      {actions}
    </article>
  );
}
