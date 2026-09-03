"use client";

import type { ChatUIMessage } from "@/lib/schemas/chat";

import MessageItem from "./MessageItem";

type MessageListProps = {
  messages: ChatUIMessage[];
  streaming: boolean;
};

export default function MessageList({ messages, streaming }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Send a message to start this conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex w-full max-w-[52.5rem] flex-col gap-4">
        <div className="sr-only" aria-live="polite">
          {streaming ? "Assistant is responding" : ""}
        </div>
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            streaming={
              streaming &&
              index === messages.length - 1 &&
              message.role === "assistant"
            }
          />
        ))}
      </div>
    </div>
  );
}
