import { isDefaultTopicTitle } from "@/i18n/defaults";

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
    isDefaultTopicTitle(input.displayedTitle)
  );
}
