import { parseEmpty, parseJson } from "@/lib/api/parse";
import {
  assistantSchema,
  assistantTreeSchema,
  type Assistant,
  type AssistantTree,
  type CreateAssistantInput,
  type UpdateAssistantInput,
} from "@/lib/schemas/assistant";

export async function listAssistantTree(): Promise<AssistantTree> {
  const response = await fetch("/api/assistants");
  return parseJson(response, (data) => assistantTreeSchema.parse(data));
}

export async function createAssistant(
  input: CreateAssistantInput,
): Promise<Assistant> {
  const response = await fetch("/api/assistants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) => assistantSchema.parse(data));
}

export async function updateAssistant(
  id: string,
  input: UpdateAssistantInput,
): Promise<Assistant> {
  const response = await fetch(`/api/assistants/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) => assistantSchema.parse(data));
}

export async function deleteAssistant(id: string): Promise<void> {
  const response = await fetch(`/api/assistants/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseEmpty(response);
}
