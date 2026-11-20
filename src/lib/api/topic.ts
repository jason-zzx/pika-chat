import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  favoriteTopicsSchema,
  topicDetailSchema,
  topicPageSchema,
  topicSchema,
  type CompressTopicInput,
  type RenameTopicInput,
  type FavoriteTopics,
  type SetTopicFavoriteInput,
  type Topic,
  type TopicPage,
  type TopicDetail,
} from "@/lib/schemas/topic";

export async function listTopicPage(
  assistantId: string,
  cursor: string | null,
): Promise<TopicPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `/api/assistants/${encodeURIComponent(assistantId)}/topics${query}`,
  );
  return parseJson(response, (data) => topicPageSchema.parse(data));
}

export async function listFavoriteTopics(
  assistantId: string,
): Promise<FavoriteTopics> {
  const response = await fetch(
    `/api/assistants/${encodeURIComponent(assistantId)}/topics/favorites`,
  );
  return parseJson(response, (data) => favoriteTopicsSchema.parse(data));
}

export async function getTopic(id: string): Promise<TopicDetail> {
  const response = await fetch(`/api/topics/${encodeURIComponent(id)}`);
  return parseJson(response, (data) => topicDetailSchema.parse(data));
}

/** Resolves once the topic's server-side title task has settled. */
export async function waitForTopicTitle(id: string): Promise<TopicDetail> {
  const response = await fetch(`/api/topics/${encodeURIComponent(id)}/title`);
  return parseJson(response, (data) => topicDetailSchema.parse(data));
}

/** Manual history compression (PRD R2): folds the topic's history into its
 * rolling summary with the session's current model. The caller only needs the
 * side effect (the refreshed detail query supplies the new boundary), so the
 * response body is not parsed. */
export async function compressTopic(
  id: string,
  input: CompressTopicInput,
): Promise<void> {
  const response = await fetch(
    `/api/topics/${encodeURIComponent(id)}/compress`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  await parseEmpty(response);
}

export async function renameTopic(
  id: string,
  input: RenameTopicInput,
): Promise<Topic> {
  const response = await fetch(`/api/topics/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) => topicSchema.parse(data));
}

export async function setTopicFavorite(
  id: string,
  input: SetTopicFavoriteInput,
): Promise<Topic> {
  const response = await fetch(
    `/api/topics/${encodeURIComponent(id)}/favorite`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return parseJson(response, (data) => topicSchema.parse(data));
}

export async function deleteTopic(id: string): Promise<void> {
  const response = await fetch(`/api/topics/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseEmpty(response);
}
