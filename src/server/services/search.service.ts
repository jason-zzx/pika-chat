import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  type MessageHit,
  type SearchResponse,
  SNIPPET_HEAD,
  SNIPPET_TOTAL,
  windowAroundMatch,
} from "@/lib/schemas/search";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  assistants,
  chatMessages,
  topicColumns,
  topics,
} from "@/server/db/schema";
import { uiPartsFromJson } from "@/server/services/message.service";

const RESULT_LIMIT = 20;

/** LIKE treats `%` and `_` as wildcards, so `%`, `_`, and `\` are escaped
 * for literal matching with `ESCAPE '\'`. */
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Global search over the actor's own data: topic titles plus the text parts
 * of selected message versions. Ownership rides the assistants join in both
 * queries — a foreign row is indistinguishable from a missing one. */
export async function searchForActor(
  actor: Actor,
  query: string,
): Promise<SearchResponse> {
  const pattern = `%${escapeLike(query)}%`;
  const db = getDb();

  const topicHits = await db
    .select({ ...topicColumns, assistantId: topics.assistantId })
    .from(topics)
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .where(
      and(
        eq(assistants.ownerId, actor.userId),
        eq(topics.temporary, false),
        sql`${topics.title} like ${pattern} escape '\\'`,
      ),
    )
    .orderBy(desc(topics.updatedAt))
    .limit(RESULT_LIMIT);

  const messageRows = await db
    .select({
      messageId: chatMessages.id,
      groupId: chatMessages.groupId,
      role: chatMessages.role,
      parts: chatMessages.parts,
      createdAt: chatMessages.createdAt,
      topicId: topics.id,
      topicTitle: topics.title,
      assistantId: topics.assistantId,
    })
    .from(chatMessages)
    .innerJoin(topics, eq(topics.id, chatMessages.topicId))
    .innerJoin(assistants, eq(assistants.id, topics.assistantId))
    .where(
      and(
        eq(assistants.ownerId, actor.userId),
        eq(topics.temporary, false),
        // Unselected versions are hidden alternative answers; jumping to one
        // would land on different content than the snippet promised.
        eq(chatMessages.isSelected, true),
        sql`exists (
          select 1 from json_each(${chatMessages.parts}) p
          where (case when p.type = 'object' then p.value->>'type' end) = 'text'
            and (case when p.type = 'object' and json_type(p.value, '$.text') = 'text' then p.value->>'text' end) like ${pattern} escape '\\'
        )`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(RESULT_LIMIT);

  const messages: MessageHit[] = messageRows.map((row) => ({
    messageId: row.messageId,
    groupId: row.groupId,
    topicId: row.topicId,
    assistantId: row.assistantId,
    topicTitle: row.topicTitle,
    role: row.role,
    createdAt: row.createdAt,
    // Same contract as the SQL match clause: text parts only, never JSON
    // keys, reasoning, or tool payloads. `uiPartsFromJson` is stricter than
    // the old hand-rolled check (invalid parts are dropped, not trusted).
    snippet: windowAroundMatch(
      uiPartsFromJson(row.parts)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      query,
      { head: SNIPPET_HEAD, total: SNIPPET_TOTAL },
    ),
  }));

  return { topics: topicHits, messages };
}
