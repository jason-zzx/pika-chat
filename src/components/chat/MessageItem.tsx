"use client";

import { Streamdown } from "streamdown";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import { cn } from "@/lib/utils";

import ReasoningBlock from "./ReasoningBlock";

type MessageItemProps = {
  message: ChatUIMessage;
  streaming?: boolean;
};

export default function MessageItem({
  message,
  streaming = false,
}: MessageItemProps) {
  const isUser = message.role === "user";
  const outcome = message.metadata?.outcome;
  const textParts = message.parts.filter((part) => part.type === "text");
  const reasoningParts = message.parts.filter(
    (part) => part.type === "reasoning",
  );
  const reasoningText = reasoningParts.map((part) => part.text).join("");
  const hasAnswer = textParts.some((part) => part.text.length > 0);
  const finishReason = message.metadata?.finishReason;

  return (
    <article
      className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
      aria-label={isUser ? "You" : "Assistant"}
    >
      {!isUser && reasoningParts.length > 0 ? (
        <ReasoningBlock
          text={reasoningText}
          streaming={streaming}
          hasAnswer={hasAnswer}
        />
      ) : null}
      <div
        className={cn(
          "text-sm",
          isUser
            ? "max-w-[min(100%,42rem)] rounded-lg bg-muted px-3 py-2 text-foreground"
            : "w-full",
        )}
      >
        {textParts.length === 0 ? (
          isUser ? null : streaming ? (
            <span className="inline-block h-4 w-1 bg-foreground/50 motion-safe:animate-pulse" />
          ) : null
        ) : isUser ? (
          textParts.map((part, index) => (
            <p key={index} className="whitespace-pre-wrap">
              {part.text}
            </p>
          ))
        ) : (
          textParts.map((part, index) => (
            <Streamdown key={index}>{part.text}</Streamdown>
          ))
        )}
      </div>
      {!isUser && !streaming && !hasAnswer && finishReason === "length" ? (
        <p className="text-xs text-muted-foreground">
          Output stopped at the token limit.
        </p>
      ) : null}
      {!isUser &&
      !streaming &&
      !hasAnswer &&
      finishReason !== "length" &&
      reasoningParts.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          The model stopped before writing an answer.
        </p>
      ) : null}
      {!isUser && outcome === "stopped" ? (
        <p className="text-xs text-muted-foreground">Stopped</p>
      ) : null}
      {!isUser && outcome === "failed" ? (
        <p className="text-xs text-destructive" role="alert">
          {message.metadata?.errorMessage ?? "The model failed to respond."}
        </p>
      ) : null}
    </article>
  );
}
