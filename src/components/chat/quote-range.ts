import type { ChatQuote } from "@/lib/schemas/chat";

/** Marks the elements holding a message's quotable body text (markdown
 * blocks, the user bubble) — never reasoning, tool calls, or meta rows. */
const QUOTE_BODY_ATTR = "data-quote-body";

function bodyOf(node: Node): Element | null {
  return (node instanceof Element ? node : node.parentElement)?.closest(
    `[${QUOTE_BODY_ATTR}]`,
  ) ?? null;
}

/** Text nodes of every body element inside a message, in document order.
 * Offsets are measured in this concatenation, so storing and matching agree
 * as long as the message renders the same DOM. */
function bodyTextNodes(article: Element): Text[] {
  const nodes: Text[] = [];
  for (const body of article.querySelectorAll(`[${QUOTE_BODY_ATTR}]`)) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text) {
        nodes.push(node);
      }
    }
  }
  return nodes;
}

/** The quote a selection would produce, or null when it does not sit inside
 * one message body within `root`. */
export function quoteFromSelection(
  selection: Selection,
  root: Element,
): ChatQuote | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const body = bodyOf(range.startContainer);
  if (!body || body !== bodyOf(range.endContainer) || !root.contains(body)) {
    return null;
  }
  const article = body.closest<HTMLElement>("[data-message-key]");
  const messageKey = article?.dataset.messageKey;
  const text = selection.toString().trim();
  if (!article || !messageKey || text.length === 0) {
    return null;
  }
  let offset = 0;
  for (const node of bodyTextNodes(article)) {
    if (node === range.startContainer) {
      offset += range.startOffset;
      break;
    }
    // A node that is not the start container either ends before the start
    // or begins at/after it.
    if (range.comparePoint(node, 0) >= 0) {
      break;
    }
    offset += node.data.length;
  }
  return { messageKey, text, offset };
}

/**
 * Locates a quote inside its source message as one Range per text node, so
 * callers can paint per-line fragments. Comparison ignores whitespace:
 * `Selection.toString()` inserts line breaks between blocks that the raw
 * text nodes do not contain. The stored offset wins over a plain search, so
 * a repeated phrase resolves to the quoted occurrence.
 */
export function findQuoteRanges(
  article: Element,
  quote: ChatQuote,
): Range[] | null {
  const needle = quote.text.replace(/\s+/g, "");
  const nodes = bodyTextNodes(article);
  const chars: { node: Text; index: number; raw: number }[] = [];
  let compact = "";
  let raw = 0;
  for (const node of nodes) {
    for (let index = 0; index < node.data.length; index += 1) {
      const char = node.data.charAt(index);
      if (!/\s/.test(char)) {
        chars.push({ node, index, raw: raw + index });
        compact += char;
      }
    }
    raw += node.data.length;
  }
  const atOffset = chars.findIndex((char) => char.raw >= quote.offset);
  const start =
    atOffset >= 0 && compact.startsWith(needle, atOffset)
      ? atOffset
      : compact.indexOf(needle);
  const first = chars[start];
  const last = chars[start + needle.length - 1];
  if (needle.length === 0 || !first || !last) {
    return null;
  }
  const ranges: Range[] = [];
  let inside = false;
  for (const node of nodes) {
    inside ||= node === first.node;
    if (!inside) {
      continue;
    }
    const range = document.createRange();
    range.setStart(node, node === first.node ? first.index : 0);
    range.setEnd(node, node === last.node ? last.index + 1 : node.data.length);
    ranges.push(range);
    if (node === last.node) {
      break;
    }
  }
  return ranges;
}
