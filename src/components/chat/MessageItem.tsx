"use client";

import { Streamdown } from "streamdown";

import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
} from "@/lib/schemas/assistant";
import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageActions from "./MessageActions";
import MessageTimestamp from "./MessageTimestamp";
import ReasoningBlock from "./ReasoningBlock";

type MessageItemProps = {
  message: ChatUIMessage;
  streaming?: boolean;
  assistantName?: string;
  assistantIcon?: string;
};

export default function MessageItem({
  message,
  streaming = false,
  assistantName,
  assistantIcon,
}: MessageItemProps) {
  const isUser = message.role === "user";
  const metadata = message.metadata;
  const outcome = metadata?.outcome;
  const modelId = metadata?.modelId;
  const createdAt = metadata?.createdAt;
  const reasoningMs = metadata?.reasoningMs;
  const textParts = message.parts.filter((part) => part.type === "text");
  const reasoningParts = message.parts.filter(
    (part) => part.type === "reasoning",
  );
  const reasoningText = reasoningParts.map((part) => part.text).join("");
  const hasAnswer = textParts.some((part) => part.text.length > 0);
  const finishReason = metadata?.finishReason;
  const plainText = textParts.map((part) => part.text).join("");

  if (isUser) {
    return (
      <article
        className="group/message flex flex-col items-end gap-1"
        aria-label="You"
      >
        <MessageTimestamp createdAt={createdAt} />
        <div className="max-w-[min(100%,42rem)] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {textParts.map((part, index) => (
            <p key={index} className="whitespace-pre-wrap">
              {part.text}
            </p>
          ))}
        </div>
        <MessageActions text={plainText} />
      </article>
    );
  }

  return (
    <article
      className="group/message flex flex-col items-start gap-1"
      aria-label="Assistant"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {assistantIcon ?? DEFAULT_ASSISTANT_ICON}{" "}
          {assistantName ?? DEFAULT_ASSISTANT_NAME}
        </span>
        <MessageTimestamp createdAt={createdAt} />
      </div>
      {reasoningParts.length > 0 ? (
        <ReasoningBlock
          text={reasoningText}
          streaming={streaming}
          hasAnswer={hasAnswer}
          reasoningMs={reasoningMs}
        />
      ) : null}
      <div className="w-full text-sm">
        {textParts.length === 0 ? (
          streaming ? (
            <span className="inline-block h-4 w-1 bg-foreground/50 motion-safe:animate-pulse" />
          ) : null
        ) : (
          textParts.map((part, index) => (
            <Streamdown key={index}>{part.text}</Streamdown>
          ))
        )}
      </div>
      {!streaming && !hasAnswer && finishReason === "length" ? (
        <p className="text-xs text-muted-foreground">
          Output stopped at the token limit.
        </p>
      ) : null}
      {!streaming &&
      !hasAnswer &&
      finishReason !== "length" &&
      reasoningParts.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          The model stopped before writing an answer.
        </p>
      ) : null}
      {outcome === "stopped" ? (
        <p className="text-xs text-muted-foreground">Stopped</p>
      ) : null}
      {outcome === "failed" ? (
        <p className="text-xs text-destructive" role="alert">
          {metadata?.errorMessage ?? "The model failed to respond."}
        </p>
      ) : null}
      {modelId ? (
        <p className="text-xs text-muted-foreground">{modelId}</p>
      ) : null}
      <MessageActions text={plainText} />
    </article>
  );
}
