"use client";

import { useTranslations } from "next-intl";
import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";

import { classifyFile } from "@/lib/files/media-types";
import { formatBytes } from "@/lib/files/format";
import { DEFAULT_ASSISTANT_ICON } from "@/lib/schemas/assistant";
import type { ChatFilePart, ChatUIMessage } from "@/lib/schemas/chat";
import {
  translateLanguageNativeName,
  type TranslateTargetLanguageCode,
} from "@/lib/translate/languages";
import { cn } from "@/lib/utils";

import AttachmentIcon from "./AttachmentIcon";
import CollapseBlock from "./CollapseBlock";
import ErrorBlock from "./ErrorBlock";
import Markdown from "./Markdown";
import FetchToolCall, { type FetchPageToolPart } from "./FetchToolCall";
import MessageActions from "./MessageActions";
import MessageTimestamp from "./MessageTimestamp";
import ReasoningBlock from "./ReasoningBlock";
import SearchToolCall, { type SearchWebToolPart } from "./SearchToolCall";
import { SHIMMER_TEXT_CLASS } from "./shimmer";
import { collectCitationSources, type CitationSource } from "./citations";

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

type FilePart = ChatFilePart;

// Non-copy wire values for attachment links; hoisted so the i18next guard does
// not read them as rendered copy.
const EXTERNAL_LINK_TARGET = "_blank";
const EXTERNAL_LINK_REL = "noreferrer noopener";

type UserAttachmentProps = { part: FilePart };

/**
 * Shrink the image link to the image's *rendered* width once loaded. The
 * anchor's fit-content uses the image's intrinsic width — a child's
 * max-w/max-h caps never feed into it — so without this the link stays
 * bubble-wide while the image renders at 16rem, and the invisible surplus
 * reads as a stray gap beside the preview. Synchronous DOM write (no state),
 * same pattern as the MessageList scroll reserve. `max-w-full` on the anchor
 * still wins on narrow bubbles, so this only ever tightens the click target.
 */
function shrinkLinkToRenderedImage(img: HTMLImageElement | null) {
  if (!img) {
    return;
  }
  const apply = () => {
    img.parentElement?.style.setProperty("width", `${img.offsetWidth}px`);
  };
  if (img.complete && img.naturalWidth > 0) {
    apply();
  } else {
    img.addEventListener("load", apply, { once: true });
  }
}

/** User-message attachment card: a thumbnail for images, a native player for
 * audio/video, a name card for everything else. */
function UserAttachment({ part }: UserAttachmentProps) {
  const t = useTranslations("Files");
  const filename = part.filename ?? "";
  const category = classifyFile({ mediaType: part.mediaType, filename });
  if (category === "image") {
    return (
      <a
        href={part.url}
        target={EXTERNAL_LINK_TARGET}
        rel={EXTERNAL_LINK_REL}
        className="inline-block max-w-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- attachment bytes are served by our own authenticated route; next/image would proxy and resize. The frame lives on the img itself so it always hugs the rendered size (see shrinkLinkToRenderedImage for the anchor's width). */}
        <img
          ref={shrinkLinkToRenderedImage}
          src={part.url}
          alt={part.filename ?? ""}
          className="block h-auto max-h-64 w-auto max-w-[min(100%,16rem)] rounded-lg border border-border"
        />
      </a>
    );
  }
  const linkClass =
    "flex max-w-[16rem] items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground";
  const card = (
    <a
      href={part.url}
      target={EXTERNAL_LINK_TARGET}
      rel={EXTERNAL_LINK_REL}
      className={linkClass}
    >
      <AttachmentIcon mediaType={part.mediaType} filename={filename} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{part.filename}</span>
        {part.sizeBytes !== undefined ? (
          <span className="text-xs text-muted-foreground">
            {formatBytes(part.sizeBytes)}
          </span>
        ) : null}
      </span>
    </a>
  );
  // Audio/video play in place through the same authenticated endpoint. Native
  // controls are the tap path on touch clients (no hover anywhere), and the
  // filename row stays a link so the file can still be opened in a new tab.
  if (category === "audio" || category === "video") {
    return (
      <div className="flex w-[min(100%,16rem)] flex-col gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
        {category === "audio" ? (
          // User media arrives without a caption track and we generate none
          // (transcription is out of scope); the player is the affordance.
          // eslint-disable-next-line jsx-a11y/media-has-caption -- no track exists to attach
          <audio
            controls
            preload="none"
            src={part.url}
            className="w-full"
            aria-label={t("preview.audio", { filename })}
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- no track exists to attach
          <video
            controls
            preload="none"
            src={part.url}
            className="h-auto max-h-64 w-full rounded"
            aria-label={t("preview.video", { filename })}
          />
        )}
        {card}
      </div>
    );
  }
  return card;
}

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

/**
 * Persisted translation of the message body (PRD 消息翻译): muted card with
 * the target language's native name as the tag and a collapse toggle (R6).
 * Same chevron + grid-rows mechanics as `ToolCallShell` (no `ui/collapsible`
 * primitive); each language owns its own open state. The Markdown remount key
 * carries the language code — Streamdown's memoization does not track prop
 * changes, so each language gets its own parse (constraint #40). `citations`
 * is forwarded so `[n]` markers inside a translation resolve to the turn's
 * source chips exactly as they do in the body (R7).
 */
const TRANSLATION_TOGGLE_CLASS =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const TRANSLATION_CHEVRON_CLASS = "size-4";
const TRANSLATION_CONTENT_CLASS = "px-3 pb-2";

function TranslationBlock({
  lang,
  text,
  citations,
}: {
  lang: string;
  text: string;
  citations?: readonly CitationSource[];
}) {
  const t = useTranslations("Chat.Translation");
  const label = translateLanguageNativeName(lang);
  return (
    <CollapseBlock
      defaultOpen
      className="w-full rounded-lg border border-border bg-muted/50 text-sm"
      buttonClassName={TRANSLATION_TOGGLE_CLASS}
      chevronClassName={TRANSLATION_CHEVRON_CLASS}
      ariaLabel={(open) =>
        open
          ? t("collapse", { language: label })
          : t("expand", { language: label })
      }
      label={({ chevron }) => (
        <>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {label}
          </span>
          {chevron}
        </>
      )}
      contentClassName={TRANSLATION_CONTENT_CLASS}
    >
      <Markdown
        key={`translation-${lang}`}
        text={text}
        citations={citations}
      />
    </CollapseBlock>
  );
}

/**
 * In-flight translation placeholder (R5): shimmering "Translating to {lang}"
 * where the finished translation will land. `role="status"` announces it to
 * assistive tech; the same shimmer classes as the body's "Thinking…"
 * indicator keep the two consistent.
 */
function TranslationPendingBlock({
  lang,
}: {
  lang: TranslateTargetLanguageCode;
}) {
  const t = useTranslations("Chat.Translation");
  return (
    <div
      role="status"
      className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
    >
      <span className={cn("inline-block font-medium", SHIMMER_TEXT_CLASS)}>
        {t("translating", { language: translateLanguageNativeName(lang) })}
      </span>
    </div>
  );
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
  /** Translate this message version into the chosen target language. */
  onTranslate?: (
    message: ChatUIMessage,
    targetLang: TranslateTargetLanguageCode,
  ) => void;
  /** Target language of an in-flight translation for this message (R5); an
   * in-progress placeholder renders where the finished block will land. */
  translatingTargetLang?: TranslateTargetLanguageCode | null;
  /** Ref attached to the root article element (used by the list to locate
   * the latest user message for scroll positioning). */
  articleRef?: Ref<HTMLElement>;
  /** Reserved minimum height for the article (the list applies the
   * viewport-minus-sent-message reserve to the streaming reply so the sent
   * message stays pinned to the viewport top while the reply grows inside
   * the reserved area). */
  minHeight?: number;
  /** True for messages inside the persisted compression boundary (PRD R10):
   * their delete / regenerate entries are withheld entirely (hidden, not
   * disabled). Copy, translate, and version switching stay available, and
   * the server returns 409 if the operation is invoked anyway. */
  compressedLocked?: boolean;
  /** Scroll anchor for this row, rendered as `data-message-key`. Handed down
   * the version-group key (`groupId ?? id`) by the list, which already uses it
   * as the React key — the item must not derive it itself. */
  itemKey?: string;
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
  onTranslate,
  translatingTargetLang,
  articleRef,
  minHeight,
  compressedLocked = false,
  itemKey,
}: MessageItemProps) {
  const t = useTranslations("Chat.MessageItem");
  const tAssistant = useTranslations("Assistant");
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
  const fileParts = message.parts.filter(
    (part): part is FilePart => part.type === "file",
  );
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
  // Per-version persisted translations (PRD 消息翻译 R4), shown below the
  // message body in insertion order.
  const translationEntries = Object.entries(metadata?.translations ?? {});

  function handleArticleClick(event: ReactMouseEvent<HTMLElement>) {
    // Buttons and links inside the message (actions, reasoning toggle,
    // streamdown copy buttons, anchors) handle their own clicks, and so do the
    // native audio/video controls — their shadow content is not a button this
    // check could see.
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, a, audio, video")
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
      onRegenerate={
        onRegenerate && !compressedLocked
          ? () => onRegenerate(message)
          : undefined
      }
      onDelete={
        onDelete && !compressedLocked ? () => onDelete(message) : undefined
      }
      onDeleteRegenerate={
        !isUser && onDeleteRegenerate && !compressedLocked
          ? () => onDeleteRegenerate(message)
          : undefined
      }
      onMenuOpenChange={setMenuOpen}
      onCopyFeedbackChange={setCopyFeedback}
      onTranslate={
        onTranslate ? (lang) => onTranslate(message, lang) : undefined
      }
      translatedLangs={translationEntries.map(([lang]) => lang)}
    />
  );

  if (isUser) {
    return (
      <article
        ref={articleRef}
        className="group/message flex flex-col items-end gap-1"
        aria-label={t("you")}
        data-revealed={revealedAny ? "true" : "false"}
        data-message-key={itemKey}
        onClick={handleArticleClick}
      >
        <MessageTimestamp createdAt={createdAt} />
        {fileParts.length > 0 ? (
          <div className="flex max-w-[min(100%,42rem)] flex-wrap justify-end gap-2">
            {fileParts.map((part, index) => (
              <UserAttachment key={`${part.url}-${index}`} part={part} />
            ))}
          </div>
        ) : null}
        {hasAnswer ? (
          <div className="max-w-[min(100%,42rem)] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
            {textParts.map((part, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {part.text}
              </p>
            ))}
          </div>
        ) : null}
        {translationEntries.length > 0 || translatingTargetLang ? (
          <div className="flex w-full max-w-[min(100%,42rem)] flex-col gap-2">
            {translationEntries.map(([lang, translatedText]) => (
              <TranslationBlock
                key={lang}
                lang={lang}
                text={translatedText}
                citations={citations}
              />
            ))}
            {translatingTargetLang ? (
              <TranslationPendingBlock lang={translatingTargetLang} />
            ) : null}
          </div>
        ) : null}
        {actions}
      </article>
    );
  }

  return (
    <article
      ref={articleRef}
      style={minHeight !== undefined ? { minHeight } : undefined}
      className="group/message flex flex-col items-start gap-1"
      aria-label={t("assistant")}
      data-revealed={revealedAny ? "true" : "false"}
      data-message-key={itemKey}
      onClick={handleArticleClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {assistantIcon ?? DEFAULT_ASSISTANT_ICON}{" "}
          {assistantName ?? tAssistant("defaultName")}
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
          <span className={cn("inline-block font-medium", SHIMMER_TEXT_CLASS)}>
            {t("thinkingShimmer")}
          </span>
        </div>
      ) : null}
      {!streaming && !hasAnswer && finishReason === "length" ? (
        <p className="text-xs text-muted-foreground">{t("tokenLimit")}</p>
      ) : null}
      {!streaming &&
      !hasAnswer &&
      finishReason !== "length" &&
      reasoningParts.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("stoppedBeforeAnswer")}
        </p>
      ) : null}
      {outcome === "stopped" ? (
        <p className="text-xs text-muted-foreground">{t("stopped")}</p>
      ) : null}
      {outcome === "failed" ? (
        metadata?.errorMessage ? (
          <ErrorBlock text={metadata.errorMessage} />
        ) : (
          <p className="text-xs text-destructive" role="alert">
            {t("failedFallback")}
          </p>
        )
      ) : null}
      {modelId ? (
        <p className="text-xs text-muted-foreground">{modelId}</p>
      ) : null}
      {translationEntries.length > 0 || translatingTargetLang ? (
        <div className="flex w-full flex-col gap-2">
          {translationEntries.map(([lang, translatedText]) => (
            <TranslationBlock
              key={lang}
              lang={lang}
              text={translatedText}
              citations={citations}
            />
          ))}
          {translatingTargetLang ? (
            <TranslationPendingBlock lang={translatingTargetLang} />
          ) : null}
        </div>
      ) : null}
      {actions}
    </article>
  );
}
