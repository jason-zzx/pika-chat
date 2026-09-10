"use client";

import { ArrowDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { Button } from "@/components/ui/button";
import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";

/** Distance to the bottom (px) that still counts as "at the bottom". Shares
 * the existing re-pin threshold in `handleScroll` so the pin and the
 * scroll-to-latest button can never disagree. */
const BOTTOM_THRESHOLD = 32;

/** Gap left above a jumped-to message; matches the send positioning. */
const JUMP_OFFSET = 16;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scrolls the container to `top`, clamped to the scrollable range. */
function scrollToPosition(container: HTMLDivElement, top: number) {
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTo({
    top: Math.min(Math.max(0, top), max),
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

export type MessageListHandle = {
  scrollToBottom: () => void;
  scrollToMessage: (key: string) => void;
};

type MessageListProps = {
  messages: ChatUIMessage[];
  streaming: boolean;
  /** Id of the message currently streaming outside the last-message default
   * (e.g. an in-place regeneration). */
  streamingMessageId?: string;
  /** Bumped by the parent each time the user sends a message. On each bump
   * the list scrolls the newly sent message to the top of the viewport and
   * pins follow-output auto-scroll for the streamed reply. */
  sendSignal?: number;
  assistantName?: string;
  assistantIcon?: string;
  onRegenerate?: (message: ChatUIMessage) => void;
  onDelete?: (message: ChatUIMessage) => void;
  onDeleteRegenerate?: (message: ChatUIMessage) => void;
  onSelectVersion?: (message: ChatUIMessage, versionId: string) => void;
  /** Imperative scroll handle (chat map jumps, scroll-to-latest). */
  ref?: Ref<MessageListHandle>;
};

export default function MessageList({
  messages,
  streaming,
  streamingMessageId,
  sendSignal,
  assistantName,
  assistantIcon,
  onRegenerate,
  onDelete,
  onDeleteRegenerate,
  onSelectVersion,
  ref,
}: MessageListProps) {
  const t = useTranslations("Chat.MessageList");
  // Single-active tap reveal (R9/B7): at most one message shows its meta /
  // actions / version switcher rows from tapping. Tapping a message reveals
  // it and it stays revealed until a different message is tapped; tapping the
  // same message again does NOT hide it. Keyed by version group (same rule
  // as the element key below) so the reveal survives a version switch,
  // delete, or regenerate of the revealed message (B1).
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  // Whether the view currently sits at the bottom; drives the scroll-to-latest
  // button. Starts true — a freshly opened conversation lands at the bottom.
  const [atBottom, setAtBottom] = useState(true);
  // Set while a smooth "back to latest" scroll is in flight. Intermediate
  // scroll events still measure far from the bottom, so without this the
  // button would flash back on for the whole animation and only disappear
  // once the scroll lands.
  const bottomPendingRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastUserElRef = useRef<HTMLElement | null>(null);
  // Follow-output pin: while true, streamed content keeps the view pinned to
  // the bottom. Scrolling up releases the pin; returning near the bottom or
  // sending a new message re-engages it.
  const pinnedRef = useRef(true);
  const handledSendSignalRef = useRef(sendSignal ?? 0);
  const seenTailUserIdRef = useRef<string | null>(null);
  // Active send-driven turn: the latest reply article gets a minimum
  // height of (viewport - sent message) so the sent message stays pinned to
  // the viewport top while the reply grows inside that reserved area; only
  // once the reply exceeds it does the view start following the tail. While
  // the reply has not appeared yet (submitted), a trailing spacer of the
  // same height reserves the space instead. The reserve stays after the
  // stream ends and is replaced on the next send; once the reply is
  // complete, upward user scrolling shrinks it by the scrolled distance
  // down to zero (ChatGPT/LobeHub style), so scrolling back down finds no
  // dead space below the reply.
  const [sendTurn, setSendTurn] = useState<{
    userId: string;
    spacer: number;
  } | null>(null);

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const lastMessage = messages[messages.length - 1];
  const tailUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const tailUserId = tailUser?.id;
  const tailStreaming =
    streaming &&
    lastMessage?.role === "assistant" &&
    (streamingMessageId === undefined || streamingMessageId === lastMessage.id);
  const sendTurnActive =
    sendTurn !== null && messages.some((m) => m.id === sendTurn.userId);
  // Reserve height for the tail reply article (or the trailing spacer while
  // the reply has not appeared); null when no send turn is active.
  const tailReserve =
    sendTurnActive && sendTurn !== null ? sendTurn.spacer : null;
  const followRef = useRef(false);
  const touchYRef = useRef<number | null>(null);
  const prevScrollTopRef = useRef(0);
  // The tail assistant article and the current (imperatively shrunk)
  // reserve height; see handleScroll.
  const lastAssistantElRef = useRef<HTMLElement | null>(null);
  const spacerLeftRef = useRef(0);
  // Mirror for the once-created ResizeObserver callback. Outside an active
  // stream (`!streaming`) a pinned view also follows growth, so a topic
  // opened at the bottom stays there while mermaid diagrams, math, and
  // images render asynchronously — but a mid-list regeneration (streaming
  // without tailStreaming or a send turn) must never yank the view down.
  useEffect(() => {
    followRef.current = tailStreaming || sendTurnActive || !streaming;
  }, [tailStreaming, sendTurnActive, streaming]);

  // Topic entry: open restored conversations at the bottom. Fires once when
  // messages first appear; a pending send claims that moment instead (the
  // send effect below positions the new message at the top), so this effect
  // is declared before it and yields while a send is unhandled, and while a
  // stream is already running (e.g. an in-flight draft send that just got
  // its server topic id).
  const enteredRef = useRef(false);
  useEffect(() => {
    if (enteredRef.current || messages.length === 0) {
      return;
    }
    enteredRef.current = true;
    if (
      streaming ||
      (sendSignal !== undefined && sendSignal !== handledSendSignalRef.current)
    ) {
      return;
    }
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, sendSignal, streaming]);

  // Send signal: scroll the newly sent message to the top of the viewport
  // and open the spacer turn. Guards tolerate the signal and the appended
  // message landing in separate commits (only act on an unseen tail user
  // message). Declared before the tracking effect below so the tracking ref
  // still holds the pre-send tail id when this runs.
  useEffect(() => {
    if (
      sendSignal === undefined ||
      sendSignal === handledSendSignalRef.current
    ) {
      return;
    }
    if (!tailUserId || tailUserId === seenTailUserIdRef.current) {
      return;
    }
    handledSendSignalRef.current = sendSignal;
    const container = containerRef.current;
    const userEl = lastUserElRef.current;
    pinnedRef.current = true;
    if (!container || !userEl) {
      return;
    }
    const top =
      userEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    // Clamps to the scrollable maximum until the spacer renders; the
    // ResizeObserver below then lands the message at the top.
    container.scrollTop = Math.max(0, top - 16);
    const spacer = Math.max(
      0,
      container.clientHeight - userEl.offsetHeight - 48,
    );
    spacerLeftRef.current = spacer;
    setSendTurn({
      userId: tailUserId,
      // 48 = container vertical padding (32) + row gap (16): with this
      // reserved height, scroll-to-bottom coincides with the sent message
      // pinned at the viewport top until the reply outgrows the reserve.
      spacer,
    });
  }, [sendSignal, tailUserId]);

  // Track the tail user message already seen so the send effect above only
  // fires for messages appended after its signal.
  useEffect(() => {
    seenTailUserIdRef.current = tailUserId ?? null;
  }, [tailUserId]);

  // Recompute "am I at the bottom" from the live container metrics. Called
  // from the scroll handler and from the ResizeObserver: content can grow or
  // shrink without firing a scroll event (e.g. deleting a message), and only
  // syncing on scroll would leave a stale button.
  const syncAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (bottomPendingRef.current) {
      // Landed: hand tracking back to the measured distance. Until then the
      // button stays hidden even though the in-flight position is not at the
      // bottom yet.
      if (distance < BOTTOM_THRESHOLD) {
        bottomPendingRef.current = false;
      }
      setAtBottom(true);
      return;
    }
    setAtBottom(distance < BOTTOM_THRESHOLD);
  }, []);

  // Pin to the bottom while the tail reply (or the send reserve) grows:
  // streamed text and reasoning both expand the content node, so a
  // ResizeObserver catches every growth step regardless of source. Outside
  // an active stream a pinned view also follows growth, so a topic opened
  // at the bottom stays there while mermaid diagrams, math, and images
  // render asynchronously. The effect re-runs on the empty/non-empty
  // transition because MessageList mounts with messages still empty
  // (history seeds after mount, drafts start empty), so the scroll
  // container does not exist on first mount.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current && followRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      syncAtBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasMessages, syncAtBottom]);

  // Re-engage the pin when the user returns to the bottom, but never release
  // it here: programmatic scrolls (send positioning, follow-output) fire
  // scroll events too, and releasing on distance would instantly cancel the
  // pin the send effect just set (the message-top position sits >32px above
  // the bottom while the reserve fills the rest).
  function handleScroll() {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const top = container.scrollTop;
    const movedUp = top < prevScrollTopRef.current;
    // Once the reply is complete, upward scrolling eats the reserved space
    // by the scrolled distance (matching ChatGPT/LobeHub). The shrink is
    // written straight to the article's style instead of going through
    // React state, so it lands in the same frame as the scroll — a state
    // round-trip renders a frame late and reads as jitter. Shrinking by
    // exactly the scroll delta keeps the distance-to-bottom invariant, so
    // visible content does not jump. Only upward user scrolls reach this
    // branch: programmatic pin scrolls always move down, and the shrink
    // itself cannot clamp scrollTop because the delta was already scrolled
    // out of the reserve.
    if (
      movedUp &&
      sendTurnActive &&
      !streaming &&
      lastMessage?.role === "assistant" &&
      spacerLeftRef.current > 0
    ) {
      const next = Math.max(
        0,
        spacerLeftRef.current - (prevScrollTopRef.current - top),
      );
      spacerLeftRef.current = next;
      const replyEl = lastAssistantElRef.current;
      if (replyEl) {
        replyEl.style.minHeight = `${next}px`;
      }
      if (next === 0) {
        // Reserve exhausted: drop the turn state so the min-height prop is
        // removed and follow-output disengages.
        setSendTurn(null);
      }
    }
    prevScrollTopRef.current = top;
    // Re-engage the pin only on downward scrolls that reach the bottom. An
    // upward scroll must never re-pin: while the reserve drains, the
    // distance-to-bottom stays near zero by design, and re-pinning here
    // would fight the wheel/touch unpin and let the ResizeObserver scroll
    // write back every frame (visible jitter).
    if (
      !movedUp &&
      container.scrollHeight - top - container.clientHeight < BOTTOM_THRESHOLD
    ) {
      pinnedRef.current = true;
    }
    syncAtBottom();
  }

  // The pin is released only by deliberate upward user scrolling (wheel or
  // touch), so programmatic positioning never fights the user.
  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    // A wheel gesture takes the scroll over from the in-flight "back to
    // latest" (browsers cancel the programmatic smooth scroll on user
    // input), so drop the pending flag and track the real position again.
    if (event.deltaY !== 0) {
      bottomPendingRef.current = false;
    }
    if (event.deltaY < 0) {
      pinnedRef.current = false;
    }
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    touchYRef.current = event.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    const y = event.touches[0]?.clientY;
    const lastY = touchYRef.current;
    touchYRef.current = y ?? null;
    // Same hand-over as the wheel: the gesture owns the scroll position now.
    bottomPendingRef.current = false;
    // Finger moves down = content scrolls up.
    if (y !== undefined && lastY !== null && y > lastY) {
      pinnedRef.current = false;
    }
  }

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // "Back to latest" means re-engaging follow-output.
    pinnedRef.current = true;
    bottomPendingRef.current = true;
    setAtBottom(true);
    scrollToPosition(container, container.scrollHeight);
  }, []);

  const scrollToMessage = useCallback((key: string) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // Release the follow pin BEFORE scrolling. The ResizeObserver follows
    // growth while `pinned && (tailStreaming || sendTurnActive || !streaming)`,
    // and `!streaming` is true whenever idle — so with the pin still set, any
    // async content (mermaid, images, math) that grows after the jump would
    // yank the view back to the bottom and undo the jump.
    pinnedRef.current = false;
    // Compare dataset values instead of building an attribute selector: ids
    // are arbitrary strings and would need escaping.
    const target = Array.from(
      container.querySelectorAll<HTMLElement>("[data-message-key]"),
    ).find((node) => node.dataset.messageKey === key);
    // The message may have been deleted while the chat map was open.
    if (!target) {
      return;
    }
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      JUMP_OFFSET;
    scrollToPosition(container, top);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ scrollToBottom, scrollToMessage }),
    [scrollToBottom, scrollToMessage],
  );

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-[52.5rem] flex-col gap-4"
        >
          <div className="sr-only" aria-live="polite">
            {streaming ? t("responding") : ""}
          </div>
          {messages.map((message, index) => {
            // Key by version group, not the per-version message id: switching
            // versions, deleting a version, or regenerating swaps in a
            // different-id row, and keying by id would remount the item (B1).
            // User messages carry no groupId metadata and never change id, so
            // they fall back to id.
            const itemKey = message.metadata?.groupId ?? message.id;
            return (
              <MessageItem
                key={itemKey}
                message={message}
                streaming={
                  streaming &&
                  (streamingMessageId !== undefined
                    ? message.id === streamingMessageId
                    : index === messages.length - 1 &&
                      message.role === "assistant")
                }
                revealed={revealedKey === itemKey}
                onReveal={() => setRevealedKey(itemKey)}
                assistantName={assistantName}
                assistantIcon={assistantIcon}
                onRegenerate={onRegenerate}
                onDelete={onDelete}
                onDeleteRegenerate={onDeleteRegenerate}
                onSelectVersion={onSelectVersion}
                articleRef={
                  index === lastUserIndex
                    ? lastUserElRef
                    : tailReserve !== null &&
                        index === messages.length - 1 &&
                        message.role === "assistant"
                      ? lastAssistantElRef
                      : undefined
                }
                minHeight={
                  tailReserve !== null &&
                  index === messages.length - 1 &&
                  message.role === "assistant"
                    ? tailReserve
                    : undefined
                }
                itemKey={itemKey}
              />
            );
          })}
          {tailReserve !== null && lastMessage?.role === "user" ? (
            <div aria-hidden="true" style={{ height: tailReserve }} />
          ) : null}
        </div>
      </div>
      {!atBottom ? (
        // Overlay spans the whole message area but must not swallow taps on
        // the messages underneath (tap-to-reveal), so only the button itself
        // takes pointer events. The inner wrapper mirrors the content column
        // width so the button hugs the messages' right edge on wide screens
        // instead of the viewport edge.
        <div className="pointer-events-none absolute inset-x-0 bottom-4 px-4">
          <div className="mx-auto flex w-full max-w-[52.5rem] justify-end">
            <Button
              type="button"
              variant="secondary"
              size="icon-lg"
              className="pointer-events-auto rounded-full"
              aria-label={t("scrollToLatest")}
              onClick={scrollToBottom}
            >
              <ArrowDownIcon aria-hidden="true" className="size-5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
