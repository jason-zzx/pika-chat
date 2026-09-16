"use client";

import type { ToolUIPart } from "ai";
import { useFormatter, useTranslations } from "next-intl";
import { z } from "zod";

import { searchProviderLabel } from "@/components/search/provider-meta";
import {
  searchWebToolOutputSchema,
  type SearchWebToolOutput,
} from "@/lib/schemas/search-provider";
import { localTimeZone } from "@/lib/time-zone";

import ToolCallShell from "./ToolCallShell";
import {
  hostnameOf,
  incompleteState,
  outputOf,
  toolErrorText,
} from "./tool-part";

/** A `tool-searchWeb` part as it arrives from useChat / persisted history. */
export type SearchWebToolPart = ToolUIPart;

const partialInputSchema = z.object({ query: z.string().optional() });

function queryOf(input: unknown): string | undefined {
  const parsed = partialInputSchema.safeParse(input);
  return parsed.success ? parsed.data.query : undefined;
}

/**
 * Short display date for a provider-reported publishedDate. Date-only
 * strings parse as local calendar days; unparseable values hide.
 */
function formatPublishedDate(
  raw: string | undefined,
  format: ReturnType<typeof useFormatter>,
): string | undefined {
  if (!raw) {
    return undefined;
  }
  // A datetime string without an offset parses in the local zone, so a
  // date-only value ("2025-02-09") stays the same calendar day everywhere.
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return format.dateTime(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    // Browser-local zone (same contract as MessageTimestamp).
    timeZone: localTimeZone(),
  });
}

type SearchToolCallProps = {
  part: SearchWebToolPart;
  /** True while this message is still streaming (see ToolCallShell). */
  streaming?: boolean;
};

export default function SearchToolCall({
  part,
  streaming = false,
}: SearchToolCallProps) {
  const t = useTranslations("Chat.Tools");
  const incomplete = incompleteState(part);
  const running = incomplete && streaming;
  const interrupted = incomplete && !streaming;

  const query = queryOf(part.input);
  const output = outputOf(part, searchWebToolOutputSchema);
  const errorText = toolErrorText(part, t("searchDeclined"));

  return (
    <ToolCallShell
      part={part}
      streaming={streaming}
      output={output}
      errorText={errorText}
      labels={{
        running: t("searchRunning"),
        interrupted: t("searchInterrupted"),
        done: t("searchDone"),
      }}
      headerMode="button"
      middle={
        query ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {query}
          </span>
        ) : (
          <span className="flex-1" />
        )
      }
    >
      <SearchToolBody
        running={running}
        interrupted={interrupted}
        output={output}
        errorText={errorText}
      />
    </ToolCallShell>
  );
}

function SearchToolBody({
  running,
  interrupted,
  output,
  errorText,
}: {
  running: boolean;
  interrupted: boolean;
  output: SearchWebToolOutput | undefined;
  errorText: string | undefined;
}) {
  const t = useTranslations("Chat.Tools");
  const format = useFormatter();
  if (running) {
    return <p className="text-muted-foreground">{t("searchBodyRunning")}</p>;
  }
  if (interrupted) {
    return (
      <p className="text-muted-foreground">{t("searchInterruptedBody")}</p>
    );
  }
  if (errorText !== undefined) {
    return (
      <p className="text-destructive" role="alert">
        {errorText}
      </p>
    );
  }
  if (output === undefined) {
    return <p className="text-muted-foreground">{t("searchNoOutput")}</p>;
  }
  if ("error" in output) {
    const attempted = output.attemptedProviders
      .map((provider) => searchProviderLabel(provider))
      .join(", ");
    return (
      <p className="text-muted-foreground">
        {attempted.length > 0
          ? t("searchFailedWithProviders", { providers: attempted })
          : t("searchFailed")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {t("searchVia")}
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
          {searchProviderLabel(output.provider)}
        </span>
      </p>
      {output.results.length === 0 ? (
        <p className="text-muted-foreground">{t("searchNoResults")}</p>
      ) : (
        <ul className="flex flex-col">
          {output.results.map((result) => {
            const host = hostnameOf(result.url);
            const letterSource = host.length > 0 ? host : result.title;
            const published = formatPublishedDate(result.publishedDate, format);
            return (
              <li key={result.url}>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                  >
                    {letterSource.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{result.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {host}
                      {published ? ` · ${published}` : ""}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
