import { isDefaultTopicTitle } from "@/i18n/defaults";

export function shouldRequestTopicTitle(input: {
  activeTopicId: string | undefined;
  displayedTitle: string;
}): boolean {
  return (
    input.activeTopicId === undefined ||
    isDefaultTopicTitle(input.displayedTitle)
  );
}
