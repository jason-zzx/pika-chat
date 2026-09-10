"use client";

import type { ToolUIPart } from "ai";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";

import { searchProviderLabel } from "@/components/search/provider-meta";
import {
  fetchPageToolOutputSchema,
  type FetchPageToolOutput,
} from "@/lib/schemas/search-provider";

import ExternalLinkDialog from "./ExternalLinkDialog";
import ToolCallShell from "./ToolCallShell";
import {
  hostnameOf,
  incompleteState,
  outputOf,
  toolErrorText,
} from "./tool-part";

/** A `tool-fetchPage` part as it arrives from useChat / persisted history. */
export type FetchPageToolPart = ToolUIPart;

/** The expanded body shows a preview only — never the full page text. */
const PREVIEW_LENGTH = 500;

const partialInputSchema = z.object({ url: z.string().optional() });

function urlOf(input: unknown): string | undefined {
  const parsed = partialInputSchema.safeParse(input);
  return parsed.success ? parsed.data.url : undefined;
}

type FetchToolCallProps = {
  part: FetchPageToolPart;
  /** True while this message is still streaming (see ToolCallShell). */
  streaming?: boolean;
};

export default function FetchToolCall({
  part,
  streaming = false,
}: FetchToolCallProps) {
  const t = useTranslations("Chat.Tools");
  const incomplete = incompleteState(part);
  const running = incomplete && streaming;
  const interrupted = incomplete && !streaming;
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const inputUrl = urlOf(part.input);
  const output = outputOf(part, fetchPageToolOutputSchema);
  const errorText = toolErrorText(part, t("fetchDeclined"));
  const pageUrl = output && !("error" in output) ? output.url : inputUrl;
  const pageTitle =
    output && !("error" in output) && output.title ? output.title : undefined;

  return (
    <ToolCallShell
      part={part}
      streaming={streaming}
      output={output}
      errorText={errorText}
      labels={{
        running: t("fetchRunning"),
        interrupted: t("fetchInterrupted"),
        done: t("fetchDone"),
      }}
      headerMode="overlay"
      toggleAriaLabel={t("fetchToggle")}
      middle={
        <>
          {pageUrl ? (
            <button
              type="button"
              className="pointer-events-auto min-w-0 flex-1 truncate rounded-md text-left text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setLinkDialogOpen(true)}
            >
              {pageTitle ?? hostnameOf(pageUrl)}
            </button>
          ) : (
            <span className="flex-1" />
          )}
          {output && !("error" in output) ? (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
              {searchProviderLabel(output.provider)}
            </span>
          ) : null}
        </>
      }
      footer={
        pageUrl ? (
          <ExternalLinkDialog
            url={pageUrl}
            open={linkDialogOpen}
            onOpenChange={setLinkDialogOpen}
          />
        ) : null
      }
    >
      <FetchToolBody
        running={running}
        interrupted={interrupted}
        output={output}
        errorText={errorText}
      />
    </ToolCallShell>
  );
}

function FetchToolBody({
  running,
  interrupted,
  output,
  errorText,
}: {
  running: boolean;
  interrupted: boolean;
  output: FetchPageToolOutput | undefined;
  errorText: string | undefined;
}) {
  const t = useTranslations("Chat.Tools");
  if (running) {
    return <p className="text-muted-foreground">{t("fetchBodyRunning")}</p>;
  }
  if (interrupted) {
    return (
      <p className="text-muted-foreground">{t("fetchInterruptedBody")}</p>
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
    return <p className="text-muted-foreground">{t("fetchNoOutput")}</p>;
  }
  if ("error" in output) {
    const attempted = output.attemptedProviders
      .map((provider) => searchProviderLabel(provider))
      .join(", ");
    return (
      <p className="text-muted-foreground">
        {attempted.length > 0
          ? t("fetchFailedWithProviders", { providers: attempted })
          : t("fetchFailed")}
      </p>
    );
  }
  const preview =
    output.content.length > PREVIEW_LENGTH
      ? `${output.content.slice(0, PREVIEW_LENGTH)}…`
      : output.content;
  return (
    <div className="flex flex-col gap-2">
      {preview.length === 0 ? (
        <p className="text-muted-foreground">{t("fetchNoText")}</p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {preview}
        </p>
      )}
      {output.truncated ? (
        <p className="text-xs text-muted-foreground">{t("fetchTruncated")}</p>
      ) : null}
    </div>
  );
}
