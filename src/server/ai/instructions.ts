import "server-only";

/**
 * Citation instruction for tool-mode turns (R14): the model cites sources
 * inline as [n] using the `num` stamped on each served result. Appended to
 * the base instructions when tools are registered; the forced final step's
 * instructions override retains it (appendForcedStepDirective appends, it
 * never replaces), which matters because the forced step is where the
 * cited answer gets written.
 */
export const CITATION_DIRECTIVE =
  "When you use information from searchWeb or fetchPage tool results, cite the source inline as [n] where n is the result's num field. Only cite nums that appeared in this turn's tool outputs.";

/**
 * Query-construction policy for tool-mode turns. Without it, a model that is
 * never told today's date dates its search query from its own training
 * cutoff ("OpenAI latest model 2025" in September 2026), so the search
 * returns last year's answer. The current-date line below supplies the
 * missing context; this line stops the model from hardcoding a year anyway.
 */
export const SEARCH_QUERY_GUIDANCE =
  "When you search the web, phrase the query with general keywords about the subject (for example \"OpenAI latest GPT model\"). Do not put a year in the query unless the user explicitly named that year; decide whether a result is current from the current date above rather than assuming a year.";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

/**
 * "Current date: Tuesday, September 15, 2026", rendered in `timeZone` when it
 * is a valid IANA zone. `timeZone` is client-supplied, so an unknown zone
 * string falls back to the server's zone instead of throwing.
 */
function currentDateLine(now: Date, timeZone?: string): string {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", options).format(now);
  try {
    return `Current date: ${format({ ...DATE_FORMAT, timeZone })}.`;
  } catch {
    return `Current date: ${format(DATE_FORMAT)}.`;
  }
}

/**
 * Assembles the system instructions for a chat turn. Both /api/chat and the
 * regenerate route call this so date injection, search guidance, and the
 * citation directive can never drift apart (D).
 *
 * Composition (in order):
 *   1. the assistant's custom system prompt, when set
 *   2. the current date — always, so time-sensitive reasoning ("latest")
 *      is anchored to today in every mode, not just tool mode (A)
 *   3. query-construction guidance + the citation directive, only when the
 *      turn registers search tools (B)
 */
export function buildChatInstructions(input: {
  systemPrompt?: string | null;
  searchEnabled?: boolean;
  timeZone?: string;
  now?: Date;
}): string {
  const { systemPrompt, searchEnabled = false, timeZone, now = new Date() } =
    input;
  const sections: string[] = [];
  const trimmed = systemPrompt?.trim();
  if (trimmed) {
    sections.push(trimmed);
  }
  sections.push(currentDateLine(now, timeZone));
  if (searchEnabled) {
    sections.push(SEARCH_QUERY_GUIDANCE, CITATION_DIRECTIVE);
  }
  return sections.join("\n\n");
}
