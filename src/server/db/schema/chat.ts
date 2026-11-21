import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { ChatUsage } from "@/lib/schemas/chat";

import { topics } from "./assistant";
import { users } from "./auth";
import { timestampMs, timestampMsDefaultNow } from "./columns";
import { providerConfigs } from "./provider";

export const chatMessageRoles = ["user", "assistant"] as const;

export const chatMessageOutcomes = ["completed", "stopped", "failed"] as const;

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    role: text("role", { enum: chatMessageRoles }).notNull(),
    parts: text("parts", { mode: "json" }).notNull(),
    outcome: text("outcome", { enum: chatMessageOutcomes }),
    errorMessage: text("error_message"),
    providerConfigId: text("provider_config_id").references(
      () => providerConfigs.id,
      { onDelete: "set null" },
    ),
    modelId: text("model_id"),
    reasoningMs: integer("reasoning_ms"),
    // Provider-reported usage/timing and finish reason. Nullable because rows
    // written before these columns (and user messages) have neither; history
    // reloads surface them so stats and truncated/limited finish feedback
    // survive a refresh.
    usage: text("usage", { mode: "json" }).$type<ChatUsage>(),
    finishReason: text("finish_reason"),
    // Per-version translations keyed by BCP-47 target language code
    // ({ "zh-CN": "…" }); null until the first translation of the row.
    translations: text("translations", { mode: "json" }).$type<
      Record<string, string>
    >(),
    // Version group: rows sharing a groupId are versions of the same answer
    // slot; a standalone message forms a single-version group (groupId = id).
    groupId: text("group_id").notNull(),
    // Exactly one selected version per group (partial unique index below).
    isSelected: integer("is_selected", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: timestampMsDefaultNow("created_at"),
    // Stable position anchor of the whole version group: set once at group
    // creation and inherited by every later version, so deleting the
    // group's earliest version can never shift the group's place in the
    // topic (deleting the implicit anchor — the earliest row's createdAt —
    // used to move the group and break regenerate target resolution).
    groupCreatedAt: timestampMsDefaultNow("group_created_at"),
  },
  (table) => [
    index("chat_messages_topic_created_idx").on(table.topicId, table.createdAt),
    index("chat_messages_topic_group_idx").on(table.topicId, table.groupId),
    uniqueIndex("chat_messages_selected_version_idx")
      .on(table.groupId)
      .where(sql`is_selected = 1`),
  ],
);

export const chatGenerationKinds = ["send", "regenerate", "edit"] as const;

export const chatGenerationStatuses = [
  "queued",
  "running",
  "stopping",
  "completed",
  "stopped",
  "failed",
  "interrupted",
] as const;

/** Input frozen at admission: everything the executor needs, and nothing it
 * must not hold (no plaintext credentials, binaries or signed URLs). */
export type ChatGenerationInput = {
  assistantId: string;
  topicId: string;
  providerConfigId: string;
  modelId: string;
  reasoningEffort?: string;
  searchMode?: "off" | "builtin" | "tool";
  image?: Record<string, string | number>;
  /** Browser IANA zone, captured at the entry so the background turn never
   * reads request-scoped cookies. */
  timeZone?: string;
  /** Fixed selected-version history the model sees (assistant placeholder
   * excluded). */
  historyMessageIds: string[];
  /** User/edit message driving the turn (already persisted). */
  userMessageId?: string;
  /** Assistant version group the placeholder joined (regenerate only). */
  assistantGroupId?: string;
  /** Position anchor when the answer slot opened a new group. */
  assistantGroupCreatedAt?: string;
  /** Regenerate target the client clicked. */
  targetMessageId?: string;
  /** The new-topic sentinel title, resolved at the entry's request locale. */
  defaultTopicTitle: string;
  /** True when this turn may still name a sentinel-titled topic without
   * clobbering a user rename (title service re-checks). */
  titleCandidate: boolean;
  /** Role captured at admission: the background turn resolves the same model
   * set as the request that admitted it, without a request-scoped session. */
  actorRole: string;
  /** True when admitted by an anonymous demo guest. */
  actorIsGuest?: boolean;
  /** Request locale captured at admission (background error text). */
  locale?: string;
  /**
   * Assistant system prompt frozen at preparation (chat task §4): the
   * background turn must not re-read configuration that may have changed
   * between admission and execution.
   */
  systemPrompt?: string | null;
  /**
   * Compression snapshot the turn was planned against: the summary text and
   * the boundary it clips the history at. Admission re-checks the durable
   * boundary inside the topic lock and rejects the turn when it moved.
   */
  summary?: {
    text: string;
    boundaryMessageId: string | null;
    boundaryGroupId: string | null;
  } | null;
};

/**
 * One accepted generation. The row is the task identity: it outlives the HTTP
 * request that admitted it, is the authorization anchor for stop/stream, and
 * carries the G2 receipt (requestId/requestHash) for confirmation-loss dedupe.
 *
 * Exactly one row per topic may be active (partial unique index) so a topic
 * has a single in-flight turn across tabs and API clients, while different
 * topics run in parallel.
 */
export const chatGenerations = sqliteTable(
  "chat_generations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: text("request_id"),
    requestHash: text("request_hash"),
    requestExpiresAt: timestampMs("request_expires_at"),
    kind: text("kind", { enum: chatGenerationKinds }).notNull(),
    status: text("status", { enum: chatGenerationStatuses })
      .notNull()
      .default("queued"),
    // Nulled when the target topic/assistant is deleted; the task itself
    // survives so late output is discarded instead of rebuilding data.
    topicId: text("topic_id").references(() => topics.id, {
      onDelete: "set null",
    }),
    assistantMessageId: text("assistant_message_id"),
    targetDeletedAt: timestampMs("target_deleted_at"),
    input: text("input", { mode: "json" }).$type<ChatGenerationInput>(),
    errorMessage: text("error_message"),
    createdAt: timestampMsDefaultNow("created_at"),
    updatedAt: timestampMsDefaultNow("updated_at"),
    startedAt: timestampMs("started_at"),
    finishedAt: timestampMs("finished_at"),
  },
  (table) => [
    uniqueIndex("chat_generations_request_idx")
      .on(table.userId, table.requestId)
      .where(sql`request_id is not null`),
    uniqueIndex("chat_generations_active_topic_idx")
      .on(table.topicId)
      .where(sql`status in ('queued', 'running', 'stopping')`),
    index("chat_generations_user_status_idx").on(
      table.userId,
      table.status,
    ),
    index("chat_generations_status_finished_idx").on(
      table.status,
      table.finishedAt,
    ),
  ],
);
