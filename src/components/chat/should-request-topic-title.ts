import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";

export function shouldRequestTopicTitle(input: {
  activeTopicId: string | undefined;
  displayedTitle: string;
  requestedTopicIds: ReadonlySet<string>;
}): boolean {
  if (
    input.activeTopicId !== undefined &&
    input.requestedTopicIds.has(input.activeTopicId)
  ) {
    return false;
  }
  return (
    input.activeTopicId === undefined ||
    input.displayedTitle === DEFAULT_TOPIC_TITLE
  );
}
