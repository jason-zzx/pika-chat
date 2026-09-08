"use client";

import { createContext } from "react";
import { defaultRemarkPlugins } from "streamdown";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import {
  fetchPageToolOutputSchema,
  searchWebToolOutputSchema,
  type SearchProvider,
} from "@/lib/schemas/search-provider";

/**
 * Inline source citations (R14): the model cites the turn's tool sources as
 * `[n]` markers in the answer text, where n is the `num` stamped on each
 * served searchWeb result / fetchPage page. This module collects the
 * message's numbered sources from its tool parts and provides the remark
 * plugin that turns resolvable `[n]` text tokens into `<sup>` markers the
 * CitationSup component renders as chips.
 */

export type CitationSource = {
  num: number;
  title: string;
  url: string;
  provider: SearchProvider;
};

/** The turn's numbered sources; consumed by CitationSup at render time. */
export const CitationSourcesContext = createContext<readonly CitationSource[]>(
  [],
);

/**
 * Walks the message's tool parts in part order and builds the turn's source
 * list. Only completed, successful outputs contribute; error outputs carry
 * no nums, and pre-R14 persisted results (no `num` field) are skipped.
 * Returns undefined when nothing is resolvable so callers can keep the
 * plain Markdown render path.
 */
export function collectCitationSources(
  parts: ChatUIMessage["parts"],
): CitationSource[] | undefined {
  const sources: CitationSource[] = [];
  for (const part of parts) {
    if (part.type === "tool-searchWeb" && part.state === "output-available") {
      const parsed = searchWebToolOutputSchema.safeParse(part.output);
      if (parsed.success && !("error" in parsed.data)) {
        for (const result of parsed.data.results) {
          if (result.num !== undefined) {
            sources.push({
              num: result.num,
              title: result.title,
              url: result.url,
              provider: parsed.data.provider,
            });
          }
        }
      }
    } else if (
      part.type === "tool-fetchPage" &&
      part.state === "output-available"
    ) {
      const parsed = fetchPageToolOutputSchema.safeParse(part.output);
      if (
        parsed.success &&
        !("error" in parsed.data) &&
        parsed.data.num !== undefined
      ) {
        sources.push({
          num: parsed.data.num,
          title: parsed.data.title ?? parsed.data.url,
          url: parsed.data.url,
          provider: parsed.data.provider,
        });
      }
    }
  }
  return sources.length > 0 ? sources : undefined;
}

// --- remark transform: `[n]` text tokens → `<sup>[n]</sup>` markers ---

/** Citation markers in answer text: `[n]` where n is a source num. */
const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;

/**
 * Minimal mdast shape — the project carries no mdast type dependency, and
 * the transform only needs text values and children arrays.
 */
export type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string };
};

/**
 * Subtrees that must never gain citation markers: links and images (a chip
 * inside an anchor would nest interactive elements) and reference
 * definitions. Fenced code, inline code, and raw HTML carry their text in
 * `value` rather than `children`, so they are excluded structurally — the
 * walker only ever rewrites `text` nodes.
 */
const SKIP_SUBTREE_TYPES = new Set([
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
  "footnoteDefinition",
]);

/**
 * Splits a text node's value around `[n]` markers. Each marker becomes a
 * text node carrying `data.hName: "sup"`, which remark-rehype turns into
 * `<sup>[n]</sup>` (the num rides in the text content because rehype-sanitize
 * strips custom attributes). Returns null when nothing matches.
 */
function splitTextValue(value: string): MdastNode[] | null {
  const matches = [...value.matchAll(CITATION_MARKER_PATTERN)];
  if (matches.length === 0) {
    return null;
  }
  const nodes: MdastNode[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    nodes.push({ type: "text", value: match[0], data: { hName: "sup" } });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }
  return nodes;
}

/** Rewrites every `[n]` text token in the tree (outside skipped subtrees). */
export function transformCitationMarkers(tree: MdastNode): void {
  if (SKIP_SUBTREE_TYPES.has(tree.type) || tree.children === undefined) {
    return;
  }
  const nextChildren: MdastNode[] = [];
  for (const child of tree.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const replacement = splitTextValue(child.value);
      if (replacement !== null) {
        nextChildren.push(...replacement);
        continue;
      }
    } else {
      transformCitationMarkers(child);
    }
    nextChildren.push(child);
  }
  tree.children = nextChildren;
}

/**
 * remark plugin marking citation tokens. The transform is source-agnostic —
 * whether a marker resolves to a real source is decided at render time by
 * CitationSup via CitationSourcesContext — so the plugin has no per-message
 * state and keeps a stable module-level identity (Streamdown's memo compares
 * plugin lists through the `plugins` prop; a fresh remarkPlugins array per
 * render would reparse every block on every streamed chunk).
 */
export function remarkCitations() {
  return (tree: MdastNode) => {
    transformCitationMarkers(tree);
  };
}

/**
 * Streamdown's remarkPlugins prop replaces its defaults, so the citation
 * plugin rides alongside them (gfm + codeMeta). Module-level for identity
 * stability.
 */
export const REMARK_PLUGINS_WITH_CITATIONS = [
  ...Object.values(defaultRemarkPlugins),
  remarkCitations,
];
