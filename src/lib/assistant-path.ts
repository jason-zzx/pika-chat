export function parseAssistantPath(pathname: string): {
  assistantId: string | undefined;
  topicId: string | undefined;
} {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "assistant") {
    return { assistantId: undefined, topicId: undefined };
  }
  return {
    assistantId: segments[1],
    topicId: segments[2],
  };
}

export function assistantDraftHref(assistantId: string): string {
  return `/assistant/${assistantId}`;
}

export function assistantTopicHref(
  assistantId: string,
  topicId: string,
): string {
  return `/assistant/${assistantId}/${topicId}`;
}
