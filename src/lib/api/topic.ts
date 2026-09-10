import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  topicSchema,
  type GenerateTopicTitleInput,
  type RenameTopicInput,
  type SetTopicFavoriteInput,
  type Topic,
} from "@/lib/schemas/topic";

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
