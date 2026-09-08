import "server-only";

import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

import type { ChatUIMessage } from "@/lib/schemas/chat";

/**
 * R9 — leaked tool-call markup.
 *
 * Weak models sometimes emit their native Hermes-style tool-call markup
 * (`<tool_call>\n<function=searchWeb>\n<parameter=query>…</parameter>\n</function>\n</tool_call>`)
 * as plain assistant TEXT — most commonly on the forced final no-tools
 * step, where the text step exists but its content is markup garbage.
 * This module strips that markup twice:
 *
 *  1. live, via `stripToolCallMarkupTransform` (an experimental_transform
 *     with a holdback buffer so tags split across chunks are caught);
 *  2. at persistence, via `stripMarkupFromTextParts` over text parts as a
 *     safety net (text parts that sanitize to nothing are dropped).
 *
 * Accepted trade-off (PRD R9): legitimately quoted tool-call markup inside
 * an answer is stripped too — leakage is far more common than that
 * discussion, and sanitization only runs on tool-mode turns.
 */

const TOOL_CALL_OPEN = "<tool_call>";
const TOOL_CALL_CLOSE = "</tool_call>";

/** Complete stray tags with no variable part (outside / without a block). */
const STRAY_TAGS = [TOOL_CALL_CLOSE, "</function>", "</parameter>"];

/**
 * Every distinct way a markup tag can start. A buffer suffix that is a
 * prefix of one of these may still grow into a tag as chunks arrive.
 */
const TAG_ROOTS = [
  TOOL_CALL_OPEN,
  TOOL_CALL_CLOSE,
  "<function=",
  "</function>",
  "<parameter=",
  "</parameter>",
];

/** Complete `<function=name>` / `<parameter=name>` fragment. */
const COMPLETE_FRAGMENT_RE = /^<(?:function|parameter)=[^>\n]*>/;

/** Partial fragment: still waiting for its closing `>`. */
const PARTIAL_FRAGMENT_RE = /^<(?:function|parameter)=[^>\n]*$/;

/** True when `s` (which starts with "<") could still grow into markup. */
function couldGrowIntoTag(s: string): boolean {
  return (
    TAG_ROOTS.some((root) => root.startsWith(s)) ||
    PARTIAL_FRAGMENT_RE.test(s)
  );
}

/**
 * Pure sanitizer: removes `<tool_call>…</tool_call>` blocks (there may be
 * several in one text), an unterminated trailing `<tool_call>` block, stray
 * `function`/`parameter` fragments and a dangling partial tag at the very
 * end, then collapses the blank-line runs the removals leave behind.
 */
export function stripToolCallMarkup(text: string): string {
  let result = text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    // An unterminated `<tool_call>` block runs to the end of the text.
    .replace(/<tool_call>[\s\S]*$/, "")
    // Stray fragments emitted outside (or without) a block.
    .replace(/<(?:function|parameter)=[^>\n]*>/g, "")
    .replace(/<\/?(?:tool_call|function|parameter)>/g, "");

  // A dangling partial tag at the very end (stream stopped mid-tag).
  const lt = result.lastIndexOf("<");
  if (lt !== -1 && couldGrowIntoTag(result.slice(lt))) {
    result = result.slice(0, lt);
  }

  // Collapse the blank-line runs the removals leave behind.
  return result.replace(/\n{3,}/g, "\n\n");
}

type DrainResult = { emit: string; hold: string };

/**
 * Incremental counterpart of `stripToolCallMarkup`: emits as much clean
 * text as possible and holds back only a suffix that could still grow into
 * markup as more chunks arrive. With `flush` the held suffix is resolved:
 * partial markup is dropped (leaked, never completed); a lone "<" is kept
 * (more likely a truncated comparison than markup).
 */
function drainMarkupBuffer(buffer: string, flush: boolean): DrainResult {
  let emit = "";
  let rest = buffer;
  for (;;) {
    const lt = rest.indexOf("<");
    if (lt === -1) {
      return { emit: emit + rest, hold: "" };
    }
    emit += rest.slice(0, lt);
    rest = rest.slice(lt);

    if (rest.startsWith(TOOL_CALL_OPEN)) {
      const close = rest.indexOf(TOOL_CALL_CLOSE);
      if (close !== -1) {
        rest = rest.slice(close + TOOL_CALL_CLOSE.length);
        continue;
      }
      // Unterminated so far: hold the whole block; on flush it is leaked
      // markup and gets dropped.
      return flush ? { emit, hold: "" } : { emit, hold: rest };
    }

    const fragment = COMPLETE_FRAGMENT_RE.exec(rest);
    if (fragment) {
      rest = rest.slice(fragment[0].length);
      continue;
    }
    const stray = STRAY_TAGS.find((tag) => rest.startsWith(tag));
    if (stray) {
      rest = rest.slice(stray.length);
      continue;
    }
    if (couldGrowIntoTag(rest)) {
      if (flush) {
        return { emit: rest === "<" ? emit + rest : emit, hold: "" };
      }
      return { emit, hold: rest };
    }
    // A "<" that cannot begin markup: clean text, keep scanning after it.
    emit += "<";
    rest = rest.slice(1);
  }
}

/**
 * experimental_transform for tool-mode turns: applies the sanitizer to
 * text-delta chunks with a holdback buffer, so markup split across chunk
 * boundaries is still caught and clean text passes through unbuffered.
 * Non-text chunks flush the hold first so stream ordering is preserved.
 */
export function stripToolCallMarkupTransform<
  TOOLS extends ToolSet,
>(): StreamTextTransform<TOOLS> {
  return () => {
    let hold = "";
    let holdId: string | null = null;
    const flushHold = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ) => {
      if (hold.length === 0 || holdId === null) {
        return;
      }
      const { emit } = drainMarkupBuffer(hold, true);
      hold = "";
      if (emit.length > 0) {
        controller.enqueue({ type: "text-delta", id: holdId, text: emit });
      }
    };
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === "text-delta") {
          holdId = chunk.id;
          const drained = drainMarkupBuffer(hold + chunk.text, false);
          hold = drained.hold;
          if (drained.emit.length > 0) {
            controller.enqueue({ ...chunk, text: drained.emit });
          }
          return;
        }
        // Keep ordering: resolve anything held before forwarding a
        // non-text chunk (text-end, tool parts, finish, …).
        flushHold(controller);
        controller.enqueue(chunk);
      },
      flush(controller) {
        flushHold(controller);
      },
    });
  };
}

/**
 * onEnd safety net: re-run the sanitizer over text parts before persistence
 * and drop text parts that sanitize to nothing, so leaked markup never
 * reaches the DB even if the live transform missed it.
 */
export function stripMarkupFromTextParts(
  parts: ChatUIMessage["parts"],
): ChatUIMessage["parts"] {
  return parts
    .map((part) =>
      part.type === "text"
        ? { ...part, text: stripToolCallMarkup(part.text) }
        : part,
    )
    .filter((part) => part.type !== "text" || part.text.trim().length > 0);
}
