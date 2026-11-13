import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { topics } from "./assistant";
import { users } from "./auth";
import { timestamptz } from "./columns";
import { providerConfigs } from "./provider";

export const chatMessageRole = pgEnum("chat_message_role", [
  "user",
  "assistant",
]);

export const chatMessageOutcome = pgEnum("chat_message_outcome", [
  "completed",
  "stopped",
  "failed",
]);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    role: chatMessageRole("role").notNull(),
    parts: jsonb("parts").notNull(),
    outcome: chatMessageOutcome("outcome"),
    errorMessage: text("error_message"),
    providerConfigId: text("provider_config_id").references(
      () => providerConfigs.id,
      { onDelete: "set null" },
    ),
    modelId: text("model_id"),
    reasoningMs: integer("reasoning_ms"),
    // Provider-reported total usage and finish reason. Nullable because rows
    // written before these columns (and user messages) have neither; history
    // reloads surface them so a truncated/limited finish keeps its feedback
    // after a refresh (chat task R7).
    totalTokens: integer("total_tokens"),
    finishReason: text("finish_reason"),
    // Per-version translations keyed by BCP-47 target language code
    // ({ "zh-CN": "…" }); null until the first translation of the row.
    translations: jsonb("translations").$type<Record<string, string>>(),
    // Version group: rows sharing a groupId are versions of the same answer
    // slot; a standalone message forms a single-version group (groupId = id).
    groupId: text("group_id").notNull(),
    // Exactly one selected version per group (partial unique index below).
    isSelected: boolean("is_selected").notNull().default(true),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    // Stable position anchor of the whole version group: set once at group
    // creation and inherited by every later version, so deleting the
    // group's earliest version can never shift the group's place in the
    // topic (deleting the implicit anchor — the earliest row's createdAt —
    // used to move the group and break regenerate target resolution).
    groupCreatedAt: timestamptz("group_created_at").notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_topic_created_idx").on(table.topicId, table.createdAt),
    index("chat_messages_topic_group_idx").on(table.topicId, table.groupId),
    uniqueIndex("chat_messages_selected_version_idx")
      .on(table.groupId)
      .where(sql`${table.isSelected}`),
  ],
);

export const chatGenerationKind = pgEnum("chat_generation_kind", [
  "send",
  "regenerate",
  "edit",
]);

export const chatGenerationStatus = pgEnum("chat_generation_status", [
  "queued",
  "running",
  "stopping",
  "completed",
  "stopped",
  "failed",
  "interrupted",
]);

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
export const chatGenerations = pgTable(
  "chat_generations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: text("request_id"),
    requestHash: text("request_hash"),
    requestExpiresAt: timestamptz("request_expires_at"),
    kind: chatGenerationKind("kind").notNull(),
    status: chatGenerationStatus("status").notNull().default("queued"),
    // Nulled when the target topic/assistant is deleted; the task itself
    // survives so late output is discarded instead of rebuilding data.
    topicId: text("topic_id").references(() => topics.id, {
      onDelete: "set null",
    }),
    assistantMessageId: text("assistant_message_id"),
    targetDeletedAt: timestamptz("target_deleted_at"),
    input: jsonb("input").$type<ChatGenerationInput>(),
    errorMessage: text("error_message"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
  },
  (table) => [
    uniqueIndex("chat_generations_request_idx")
      .on(table.userId, table.requestId)
      .where(sql`${table.requestId} is not null`),
    uniqueIndex("chat_generations_active_topic_idx")
      .on(table.topicId)
      .where(sql`${table.status} in ('queued', 'running', 'stopping')`),
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
