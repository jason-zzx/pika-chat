import { headers } from "next/headers";
import { notFound } from "next/navigation";

import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import { resolveActor } from "@/server/auth/actor";
import { findTopicForActor } from "@/server/services/topic.service";

type TopicPageProps = {
  params: Promise<{ topicId: string }>;
};

export default async function TopicPage({ params }: TopicPageProps) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    notFound();
  }
  const { topicId } = await params;
  const topic = await findTopicForActor(topicId, actor);
  if (!topic) {
    notFound();
  }

  return (
    <PageContainer>
      <PageHeader title={topic.title} />
      <EmptyState
        title="Messaging is not available yet"
        description="This topic is ready. Sending and receiving messages will land in a later update."
      />
    </PageContainer>
  );
}
