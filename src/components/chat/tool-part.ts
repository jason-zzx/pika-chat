import type { ToolUIPart } from "ai";
import type { z } from "zod";

/** Part states that have no output yet (call streaming in or awaiting run). */
export function incompleteState(part: ToolUIPart): boolean {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested"
  );
}

/** The parsed output of an `output-available` part; undefined otherwise. */
export function outputOf<Schema extends z.ZodType>(
  part: ToolUIPart,
  schema: Schema,
): z.infer<Schema> | undefined {
  if (part.state !== "output-available") {
    return undefined;
  }
  const parsed = schema.safeParse(part.output);
  return parsed.success ? parsed.data : undefined;
}

/** User-facing error text for errored or denied tool parts. */
export function toolErrorText(
  part: ToolUIPart,
  deniedMessage: string,
): string | undefined {
  if (part.state === "output-error") {
    return part.errorText;
  }
  if (part.state === "output-denied") {
    return deniedMessage;
  }
  return undefined;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
