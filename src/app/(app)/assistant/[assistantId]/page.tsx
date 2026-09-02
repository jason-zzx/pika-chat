import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ChatView from "@/components/chat/ChatView";
import { resolveActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { requireOwnedAssistant } from "@/server/services/assistant.service";

type AssistantDraftPageProps = {
  params: Promise<{ assistantId: string }>;
};

export default async function AssistantDraftPage({
  params,
}: AssistantDraftPageProps) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    notFound();
  }
  const { assistantId } = await params;
  let assistant;
  try {
    assistant = await requireOwnedAssistant(assistantId, actor);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatView
        assistantId={assistant.id}
        assistantDefaultProviderConfigId={assistant.defaultProviderConfigId}
        assistantDefaultModelId={assistant.defaultModelId}
      />
    </div>
  );
}
