import EmptyState from "@/components/common/EmptyState";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";

export default function HomePage() {
  return (
    <PageContainer>
      <PageHeader title="Chat" />
      <EmptyState
        title="Nothing to send yet"
        description="A provider must be configured before chatting."
      />
    </PageContainer>
  );
}
