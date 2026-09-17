import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  topicDetailSchema,
  topicSchema,
  type CompressTopicInput,
  type GenerateTopicTitleInput,
  type RenameTopicInput,
  type SetTopicFavoriteInput,
  type Topic,
  type TopicDetail,
} from "@/lib/schemas/topic";

export async function getTopic(id: string): Promise<TopicDetail> {
  const response = await fetch(`/api/topics/${encodeURIComponent(id)}`);
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

export async function generateTopicTitle(
  id: string,
  input: GenerateTopicTitleInput,
): Promise<Topic> {
  const response = await fetch(
    `/api/topics/${encodeURIComponent(id)}/title`,
    {
      method: "POST",
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
