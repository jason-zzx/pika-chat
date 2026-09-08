"use client";

import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";

import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
} from "@/lib/schemas/assistant";
import type { ChatUIMessage } from "@/lib/schemas/chat";

import Markdown from "./Markdown";
import FetchToolCall, { type FetchPageToolPart } from "./FetchToolCall";
import MessageActions from "./MessageActions";
import MessageTimestamp from "./MessageTimestamp";
import ReasoningBlock from "./ReasoningBlock";
import SearchToolCall, { type SearchWebToolPart } from "./SearchToolCall";
import { collectCitationSources } from "./citations";

type ContentBlock =
  | {
      kind: "reasoning";
      key: string;
      text: string;
      /** 0-based position among the message's reasoning blocks — indexes
       * the per-phase duration lists (metadata / persisted parts). */
      order: number;
      /** Per-phase duration persisted on the reasoning part (reloaded
       * history); the live stream announces durations via metadata instead. */
      durationMs?: number;
    }
  | { kind: "text"; key: string; text: string }
  | { kind: "tool-searchWeb"; key: string; part: SearchWebToolPart }
  | { kind: "tool-fetchPage"; key: string; part: FetchPageToolPart };

/** Reads the persisted per-phase duration off a reasoning part (the field
 * lives in the stored-part schema, outside the SDK's UIMessage part type). */
function durationMsOf(part: object): number | undefined {
  if ("durationMs" in part && typeof part.durationMs === "number") {
    return part.durationMs;
  }
  return undefined;
}

/** True once a tool part has a final outcome (output or error) — i.e. the
 * tool stopped running and the model's next step has not started yet. */
function toolPartFinished(part: SearchWebToolPart | FetchPageToolPart): boolean {
  return (
    part.state !== "input-streaming" &&
    part.state !== "input-available" &&
    part.state !== "approval-requested"
  );
}

/**
 * Folds message parts into renderable blocks in part order: adjacent
 * reasoning parts collapse into one block (the previous single-block
 * behavior), text renders as Markdown, searchWeb/fetchPage tool calls render
 * as collapsible blocks; step-start and unknown parts render nothing.
 */
function buildContentBlocks(parts: ChatUIMessage["parts"]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let reasoningStart = -1;
  let reasoningTexts: string[] = [];
  let reasoningDurationMs: number | undefined;
  const flushReasoning = () => {
    if (reasoningStart < 0) {
      return;
    }
    blocks.push({
      kind: "reasoning",
      key: `reasoning-${reasoningStart}`,
      text: reasoningTexts.join(""),
      order: blocks.filter((block) => block.kind === "reasoning").length,
      durationMs: reasoningDurationMs,
    });
    reasoningStart = -1;
    reasoningTexts = [];
    reasoningDurationMs = undefined;
  };
  parts.forEach((part, index) => {
    if (part.type === "reasoning") {
      if (reasoningStart < 0) {
        reasoningStart = index;
        reasoningDurationMs = durationMsOf(part);
      }
      reasoningTexts.push(part.text);
      return;
    }
    flushReasoning();
    if (part.type === "text") {
      blocks.push({ kind: "text", key: `text-${index}`, text: part.text });
    } else if (part.type === "tool-searchWeb") {
      blocks.push({
        kind: "tool-searchWeb",
        key: part.toolCallId,
        part,
      });
    } else if (part.type === "tool-fetchPage") {
      blocks.push({
        kind: "tool-fetchPage",
        key: part.toolCallId,
        part,
      });
    }
  });
  flushReasoning();
  return blocks;
}

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
  /** Ref attached to the root article element (used by the list to locate
   * the latest user message for scroll positioning). */
  articleRef?: Ref<HTMLElement>;
  /** Reserved minimum height for the article (the list applies the
   * viewport-minus-sent-message reserve to the streaming reply so the sent
   * message stays pinned to the viewport top while the reply grows inside
   * the reserved area). */
  minHeight?: number;
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
  articleRef,
  minHeight,
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
  const reasoningDurations = metadata?.reasoningDurations;
  const textParts = message.parts.filter((part) => part.type === "text");
  const reasoningParts = message.parts.filter(
    (part) => part.type === "reasoning",
  );
  const hasAnswer = textParts.some((part) => part.text.length > 0);
  const contentBlocks = buildContentBlocks(message.parts);
  // R14: the turn's numbered tool sources, walked in part order; text
  // blocks render `[n]` markers resolving to them as citation chips.
  const citations = collectCitationSources(message.parts);
  // Waiting indicator: while the tail message streams, show the shimmer
  // when nothing has arrived yet OR the last block is a finished tool call
  // (the model is composing the next step). A running tool block shows its
  // own spinner instead, and the shimmer hides as soon as new reasoning or
  // text trails the tool result (R8).
  const lastBlock = contentBlocks[contentBlocks.length - 1];
  const showThinkingShimmer =
    streaming &&
    (lastBlock === undefined ||
      ((lastBlock.kind === "tool-searchWeb" ||
        lastBlock.kind === "tool-fetchPage") &&
        toolPartFinished(lastBlock.part)));
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
        ref={articleRef}
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
      ref={articleRef}
      style={minHeight !== undefined ? { minHeight } : undefined}
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
      {contentBlocks.map((block, blockIndex) => {
        if (block.kind === "reasoning") {
          // Block i shows phase duration i: live from the early-emitted
          // metadata list, reloaded from the persisted part, falling back
          // to the message-level reasoningMs total on the first block for
          // legacy rows (R6).
          const durationMs =
            reasoningDurations?.[block.order] ??
            block.durationMs ??
            (block.order === 0 ? reasoningMs : undefined);
          // A phase ends when a later block exists or the stream finished;
          // only the actively streaming last block stays open as "Thinking".
          const ended = !streaming || blockIndex < contentBlocks.length - 1;
          return (
            <ReasoningBlock
              key={block.key}
              text={block.text}
              streaming={streaming}
              ended={ended}
              reasoningMs={durationMs}
            />
          );
        }
        if (block.kind === "text") {
          return (
            <div key={block.key} className="w-full text-sm">
              <Markdown text={block.text} citations={citations} />
            </div>
          );
        }
        if (block.kind === "tool-searchWeb") {
          return (
            <SearchToolCall
              key={block.key}
              part={block.part}
              streaming={streaming}
            />
          );
        }
        return (
          <FetchToolCall
            key={block.key}
            part={block.part}
            streaming={streaming}
          />
        );
      })}
      {showThinkingShimmer ? (
        <div className="w-full text-sm">
          <span className="inline-block animate-thinking-shimmer bg-linear-to-r from-muted-foreground/40 via-foreground to-muted-foreground/40 bg-[length:200%_100%] bg-clip-text font-medium text-transparent motion-reduce:animate-none">
            Thinking…
          </span>
        </div>
      ) : null}
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
