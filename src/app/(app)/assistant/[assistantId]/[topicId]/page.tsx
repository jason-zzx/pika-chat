import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import ChatView from "@/components/chat/ChatView";
import { assistantDraftHref } from "@/lib/assistant-path";
import { resolveActor } from "@/server/auth/actor";
import { findTopicContextForActor } from "@/server/services/topic.service";

type TopicPageProps = {
  params: Promise<{ assistantId: string; topicId: string }>;
};

export default async function AssistantTopicPage({ params }: TopicPageProps) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    notFound();
  }
  const { assistantId, topicId } = await params;
  const context = await findTopicContextForActor(topicId, actor);
  // A deleted, unknown, or re-parented topic makes this a stale URL rather
  // than a missing page: land on this assistant's new-topic draft.
  if (!context || context.assistant.id !== assistantId) {
    redirect(assistantDraftHref(assistantId));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatView
        assistantId={context.assistant.id}
        topicId={context.topic.id}
        topicTitle={context.topic.title}
        assistantDefaultProviderConfigId={
          context.assistant.defaultProviderConfigId
        }
        assistantDefaultModelId={context.assistant.defaultModelId}
      />
    </div>
  );
}
