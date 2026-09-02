"use client";

import { Streamdown } from "streamdown";

import type { ChatUIMessage } from "@/lib/schemas/chat";
import { cn } from "@/lib/utils";

type MessageItemProps = {
  message: ChatUIMessage;
};

export default function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";
  const outcome = message.metadata?.outcome;
  const textParts = message.parts.filter((part) => part.type === "text");

  return (
    <article
      className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
      aria-label={isUser ? "You" : "Assistant"}
    >
      <div
        className={cn(
          "text-sm",
          isUser
            ? "max-w-[min(100%,42rem)] rounded-lg bg-muted px-3 py-2 text-foreground"
            : "w-full",
        )}
      >
        {textParts.length === 0 ? (
          isUser ? null : (
            <span className="inline-block h-4 w-1 bg-foreground/50 motion-safe:animate-pulse" />
          )
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
