import { z } from "zod";

import { topicSchema } from "@/lib/schemas/topic";

/** Query length cap for GET /api/search — overlong input is truncated, not
 * rejected (search is a fuzzy match anyway). */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/** Topic title hit: the shared topic projection plus its owning assistant,
 * which the client needs to build the topic URL. */
export const topicHitSchema = topicSchema.extend({
  assistantId: z.string(),
});
export type TopicHit = z.infer<typeof topicHitSchema>;

/** Message content hit: the snippet is built app-side from the selected
 * version's text parts (asymmetric window: ~16 chars head, ~120 total). */
export const messageHitSchema = z.object({
  messageId: z.string(),
  groupId: z.string(),
  topicId: z.string(),
  assistantId: z.string(),
  topicTitle: z.string(),
  role: z.enum(["user", "assistant"]),
  snippet: z.string(),
  createdAt: z.coerce.date(),
});
export type MessageHit = z.infer<typeof messageHitSchema>;

export const searchResponseSchema = z.object({
  topics: z.array(topicHitSchema),
  messages: z.array(messageHitSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Asymmetric snippet window (PRD R7c): the sidebar renders `line-clamp-2`,
 * so only a short head context fits before the match — the rest of the
 * budget goes after it, keeping the match inside the first two lines. */
export const SNIPPET_HEAD = 16;
export const SNIPPET_TOTAL = 120;
/** Topic-title window (PRD R7b): a title longer than this renders a slice
 * around the match with ellipses, so `truncate` can never hide the marked
 * term. Head context mirrors the snippet window. */
export const TITLE_HEAD = 16;
export const TITLE_TOTAL = 48;

/** Slice of `text` around the first case-insensitive match of `query`, with
 * a short head context and the rest of the budget after the match. Short
 * text (≤ total) returns in full; no match returns the text head. */
export function windowAroundMatch(
  text: string,
  query: string,
  options: { head: number; total: number },
): string {
  if (text.length <= options.total) {
    return text;
  }
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return text.slice(0, options.total);
  }
  const start = Math.max(0, index - options.head);
  const end = Math.min(text.length, start + options.total);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
