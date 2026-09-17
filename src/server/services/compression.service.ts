import "server-only";

import { generateText } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import type { ChatModelHandle } from "@/server/ai/chat-model";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { assistants, chatMessages, topics } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { listTopicMessages } from "@/server/services/message.service";
import { findTopicForActor } from "@/server/services/topic.service";

/** Auto-compression fires once the effective history exceeds this share of
 * the model's context window (PRD R1: 80%). */
export const HISTORY_COMPRESSION_RATIO = 0.8;

/**
 * No tokenizer dependency: a conservative chars-per-token heuristic. CJK is
 * ~1 token per character and English ~4 chars per token, so 2 overestimates
 * for English (the common case) and stays safe for Chinese. Overestimating
 * only compresses earlier, which is the acceptable direction.
 */
const CHARS_PER_TOKEN = 2;

/** Fixed per-attachment allowance — the extracted text is not re-read here,
 * so a file part counts a flat budget regardless of its true size. */
export const FILE_PART_TOKEN_ALLOWANCE = 1000;

const SUMMARY_TIMEOUT_MS = 30_000;
const SUMMARY_MAX_OUTPUT_TOKENS = 1024;

export function estimateMessagesTokens(messages: ChatUIMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        total += Math.ceil(part.text.length / CHARS_PER_TOKEN);
      } else if (part.type === "file") {
        total += FILE_PART_TOKEN_ALLOWANCE;
      } else {
        // Tool invocations and step markers: serialized size is the only
        // available proxy, and tool outputs can be the largest parts.
        total += Math.ceil(JSON.stringify(part).length / CHARS_PER_TOKEN);
      }
    }
  }
  return total;
}

/** True when the effective history (plus the message about to be sent)
 * crosses the compression threshold for this model's context window. */
export function exceedsCompressionThreshold(
  messages: ChatUIMessage[],
  contextTokens: number,
): boolean {
  return (
    estimateMessagesTokens(messages) >
    contextTokens * HISTORY_COMPRESSION_RATIO
  );
}

/**
 * Compression boundary, identified by version group rather than the raw row
 * id: the summarized region is a range of version groups, so switching the
 * selected version of the boundary group must not move the boundary. `id`
 * alone is only the fallback for rows that predate grouping.
 */
export type CompressionBoundary = {
  /** Selected-version row id of the boundary message. */
  id: string;
  /** Version group of the boundary row; null when the row no longer resolves. */
  groupId: string | null;
};

/** Maps the persisted summary state onto the boundary shape. Null when the
 * topic has never been compressed or the boundary is missing. */
export function boundaryFromSummaryState(
  state: {
    summaryUpToMessageId: string | null;
    summaryUpToGroupId: string | null;
  } | null,
): CompressionBoundary | null {
  if (!state?.summaryUpToMessageId) {
    return null;
  }
  return {
    id: state.summaryUpToMessageId,
    groupId: state.summaryUpToGroupId,
  };
}

/**
 * The messages still outside the summary: everything after the boundary
 * group. Matching is by group (falling back to the row id for pre-grouping
 * data), so switching the selected version of the boundary group keeps
 * clipping at the same place instead of falling back to the full history and
 * duplicating what the summary already covers. A boundary group that no
 * longer resolves (its messages were deleted) falls back to the full history —
 * over-sending beats silently dropping turns the summary no longer provably
 * covers.
 */
export function messagesAfterBoundary(
  messages: ChatUIMessage[],
  boundary: CompressionBoundary | null,
): ChatUIMessage[] {
  if (!boundary) {
    return messages;
  }
  const boundaryKey = boundary.groupId ?? boundary.id;
  const index = messages.findIndex(
    (message) => (message.metadata?.groupId ?? message.id) === boundaryKey,
  );
  return index >= 0 ? messages.slice(index + 1) : messages;
}

export type TopicSummaryState = {
  summaryText: string;
  /** Compression boundary: this message (inclusive) and everything before it
   * is covered by `summaryText`. */
  summaryUpToMessageId: string | null;
  /** Version group of the boundary row — the identity the client marker/lock
   * and the server clipping agree on. Null when the boundary row no longer
   * resolves. */
  summaryUpToGroupId: string | null;
};

/** Summary state for an owned topic; `null` when the topic does not exist
 * for this actor or has never been compressed. */
export async function getTopicSummaryState(
  topicId: string,
  actor: Actor,
): Promise<TopicSummaryState | null> {
  const db = getDb();
  const rows = await db
    .select({
      summaryText: topics.summaryText,
      summaryUpToMessageId: topics.summaryUpToMessageId,
      summaryUpToGroupId: chatMessages.groupId,
    })
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .leftJoin(chatMessages, eq(chatMessages.id, topics.summaryUpToMessageId))
    .where(and(eq(topics.id, topicId), eq(assistants.ownerId, actor.userId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.summaryText === null) {
    return null;
  }
  return {
    summaryText: row.summaryText,
    summaryUpToMessageId: row.summaryUpToMessageId,
    summaryUpToGroupId: row.summaryUpToGroupId,
  };
}

export const SUMMARY_INSTRUCTIONS = [
  "Summarize the earlier conversation between the user and the assistant.",
  "Preserve key facts, decisions, user preferences, conclusions, and open tasks or questions; drop small talk and redundant detail.",
  "When a previous summary is provided, merge the new messages into it as one coherent updated summary.",
  "Write in the conversation's language. Output the summary only — no preamble, no notes, no surrounding quotes.",
].join(" ");

/**
 * Text-only transcript for the summary model: attachment payloads never
 * leave the app for summarization; a file part becomes a filename marker so
 * the summary still records that a file was shared.
 */
export function transcriptForSummary(messages: ChatUIMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const role = message.role === "user" ? "User" : "Assistant";
    const chunks: string[] = [];
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim().length > 0) {
        chunks.push(part.text);
      } else if (part.type === "file") {
        chunks.push(`[Attachment: ${part.filename ?? "file"}]`);
      }
    }
    if (chunks.length > 0) {
      lines.push(`${role}: ${chunks.join("\n")}`);
    }
  }
  return lines.join("\n\n");
}

export type CompressionResult = {
  summaryText: string;
  summaryUpToMessageId: string;
  /** Version group of the new boundary row. */
  summaryUpToGroupId: string;
  /** Messages folded into the summary by this run (excludes previously
   * compressed ones). */
  compressedCount: number;
};

/**
 * Compresses the topic's history up to its current last message: merges the
 * not-yet-summarized selected-version messages into the rolling summary with
 * the caller's chat model, then persists summary + boundary on the topic.
 * Original messages are never modified (PRD R4). The boundary only moves
 * forward across runs (PRD R5).
 *
 * Throws `topic.nothingToCompress` when there is no unsummarized history —
 * the auto-compression caller catches every failure and continues
 * uncompressed; the manual endpoint surfaces it as a 400.
 */
export async function compressTopicHistory(
  input: { topicId: string; handle: ChatModelHandle },
  actor: Actor,
): Promise<CompressionResult> {
  const topic = await findTopicForActor(input.topicId, actor);
  if (!topic) {
    throw new AppError("NOT_FOUND", 404, "topic.notFound");
  }
  const state = await getTopicSummaryState(input.topicId, actor);
  // listTopicMessages already returns the selected version of each group, so
  // the summary is built from exactly what the model would have seen.
  const messages = await listTopicMessages({ topicId: input.topicId }, actor);
  const uncovered = messagesAfterBoundary(
    messages,
    boundaryFromSummaryState(state),
  );
  const boundary = messages[messages.length - 1];
  if (!boundary || uncovered.length === 0) {
    throw new AppError("VALIDATION_FAILED", 400, "topic.nothingToCompress");
  }

  const transcript = transcriptForSummary(uncovered);
  if (transcript.length === 0) {
    throw new AppError("VALIDATION_FAILED", 400, "topic.nothingToCompress");
  }
  const prompt = state
    ? `<previous-summary>\n${state.summaryText}\n</previous-summary>\n\n<new-messages>\n${transcript}\n</new-messages>`
    : `<messages>\n${transcript}\n</messages>`;

  const result = await generateText({
    model: input.handle.model,
    instructions: SUMMARY_INSTRUCTIONS,
    prompt,
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
  });
  const summaryText = result.text.trim();
  if (summaryText.length === 0) {
    throw new AppError("PROVIDER_ERROR", 502, "provider.unexpectedResponse");
  }

  const db = getDb();
  await db
    .update(topics)
    .set({
      summaryText,
      summaryUpToMessageId: boundary.id,
    })
    .where(
      and(
        eq(topics.id, input.topicId),
        inArray(
          topics.assistantId,
          db
            .select({ id: assistants.id })
            .from(assistants)
            .where(eq(assistants.ownerId, actor.userId)),
        ),
      ),
    );

  return {
    summaryText,
    summaryUpToMessageId: boundary.id,
    summaryUpToGroupId: boundary.metadata?.groupId ?? boundary.id,
    compressedCount: uncovered.length,
  };
}
