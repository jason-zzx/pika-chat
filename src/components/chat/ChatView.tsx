"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

import { assistantKeys, useAssistantTree } from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
import { stopChatStream } from "@/lib/api/chat";
import { assistantTopicHref } from "@/lib/assistant-path";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import { useComposerStore } from "@/stores/composer-store";

import Composer from "./Composer";
import MessageList from "./MessageList";
import { chatKeys, useChatHistory } from "./use-chat-history";

function markLastAssistant(
  current: ChatUIMessage[],
  outcome: "stopped" | "failed",
): ChatUIMessage[] {
  const last = current[current.length - 1];
  if (!last || last.role !== "assistant" || last.metadata?.outcome === outcome) {
    return current;
  }
  return current.map((message, index) =>
    index === current.length - 1
      ? { ...message, metadata: { ...message.metadata, outcome } }
      : message,
  );
}

type ChatViewProps = {
  assistantId?: string;
  topicId?: string;
  topicTitle?: string;
  assistantDefaultProviderConfigId?: string | null;
  assistantDefaultModelId?: string | null;
};

export default function ChatView({
  assistantId,
  topicId,
  topicTitle,
  assistantDefaultProviderConfigId,
  assistantDefaultModelId,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const tree = useAssistantTree();
  const history = useChatHistory(topicId);
  const chatId = topicId ?? "draft";
  const [activeTopicId, setActiveTopicId] = useState(topicId);
  const [streamId, setStreamId] = useState<string | null>(null);
  const seededHistory = useRef(false);
  const seededModel = useRef<string | null>(null);
  const latestRef = useRef({
    assistantId: assistantId ?? "",
    topicId,
  });

  const draft = useComposerStore((state) => state.draft);
  const setDraft = useComposerStore((state) => state.setDraft);
  const pickedModel = useComposerStore((state) => state.pickedModel);
  const setPickedModel = useComposerStore((state) => state.setPickedModel);
  const recentAssistantId = useComposerStore((state) => state.recentAssistantId);
  const setRecentAssistantId = useComposerStore(
    (state) => state.setRecentAssistantId,
  );

  const assistants = tree.data?.assistants ?? [];
  const resolvedAssistantId = assistantId ?? recentAssistantId ?? assistants[0]?.id;
  const resolvedAssistant = assistants.find((row) => row.id === resolvedAssistantId);
  const showAssistantPicker = assistantId === undefined;
  const headerTitle =
    (activeTopicId
      ? assistants
          .flatMap((assistant) => assistant.topics)
          .find((topic) => topic.id === activeTopicId)?.title
      : undefined) ??
    topicTitle ??
    "New topic";

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            message: messages[messages.length - 1],
          },
        }),
      }),
  );

  const { messages, status, error, sendMessage, stop, setMessages } =
    useChat<ChatUIMessage>({
      id: chatId,
      transport,
      onData: (part) => {
        if (part.type !== "data-topic") {
          return;
        }
        latestRef.current.topicId = part.data.topicId;
        setActiveTopicId(part.data.topicId);
        setStreamId(part.data.streamId);
        const assistant = latestRef.current.assistantId;
        if (assistant.length === 0) {
          return;
        }
        window.history.replaceState(
          window.history.state,
          "",
          assistantTopicHref(assistant, part.data.topicId),
        );
      },
      onFinish: () => {
        const topic = latestRef.current.topicId;
        void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
        if (topic) {
          void queryClient.invalidateQueries({
            queryKey: chatKeys.history(topic),
          });
        }
      },
    });

  useEffect(() => {
    if (assistantId) {
      setRecentAssistantId(assistantId);
    }
  }, [assistantId, setRecentAssistantId]);

  useEffect(() => {
    if (!topicId || !history.data || seededHistory.current) {
      return;
    }
    seededHistory.current = true;
    setMessages(history.data.messages);
  }, [history.data, setMessages, topicId]);

  useEffect(() => {
    const key = topicId ?? `draft:${resolvedAssistantId ?? "none"}`;
    if (topicId && history.isPending) {
      return;
    }
    if (seededModel.current === key) {
      return;
    }
    const historyMessages = history.data?.messages ?? messages;
    const lastAssistant = [...historyMessages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.metadata?.providerConfigId &&
          message.metadata.modelId,
      );
    const fromHistory =
      lastAssistant?.metadata?.providerConfigId && lastAssistant.metadata.modelId
        ? {
            configId: lastAssistant.metadata.providerConfigId,
            modelId: lastAssistant.metadata.modelId,
          }
        : null;
    const fromAssistant =
      (assistantDefaultProviderConfigId && assistantDefaultModelId
        ? {
            configId: assistantDefaultProviderConfigId,
            modelId: assistantDefaultModelId,
          }
        : null) ??
      (resolvedAssistant?.defaultProviderConfigId &&
      resolvedAssistant.defaultModelId
        ? {
            configId: resolvedAssistant.defaultProviderConfigId,
            modelId: resolvedAssistant.defaultModelId,
          }
        : null);
    seededModel.current = key;
    setPickedModel(fromHistory ?? fromAssistant);
  }, [
    assistantDefaultModelId,
    assistantDefaultProviderConfigId,
    history.data?.messages,
    history.isPending,
    messages,
    resolvedAssistant,
    resolvedAssistantId,
    setPickedModel,
    topicId,
  ]);

  useEffect(() => {
    if (status !== "error") {
      return;
    }
    setMessages((current) => markLastAssistant(current, "failed"));
  }, [setMessages, status]);

  const inFlight = status === "submitted" || status === "streaming";
  const canSend =
    draft.trim().length > 0 &&
    Boolean(resolvedAssistantId) &&
    Boolean(pickedModel) &&
    !inFlight &&
    (!topicId || history.isSuccess);

  async function handleStop() {
    if (streamId) {
      try {
        await stopChatStream(streamId);
      } catch {
        // Unknown or already finished streams are NOT_FOUND; still stop locally.
      }
    }
    await stop();
    setMessages((current) => markLastAssistant(current, "stopped"));
  }

  function handleSend() {
    if (!canSend || !pickedModel || !resolvedAssistantId) {
      return;
    }
    setRecentAssistantId(resolvedAssistantId);
    latestRef.current = {
      assistantId: resolvedAssistantId,
      topicId: activeTopicId,
    };
    const text = draft.trim();
    setDraft("");
    void sendMessage(
      { text },
      {
        body: {
          assistantId: resolvedAssistantId,
          topicId: activeTopicId,
          providerConfigId: pickedModel.configId,
          modelId: pickedModel.modelId,
        },
      },
    );
  }

  if (topicId && history.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState
          title="Unable to load conversation"
          description="Refresh the page to try again."
        />
      </div>
    );
  }

  const historyPending = Boolean(topicId) && history.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h1 className="truncate text-lg font-semibold tracking-tight">
          {headerTitle}
        </h1>
      </div>
      {historyPending ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Loading conversation…
          </p>
        </div>
      ) : (
        <MessageList messages={messages} streaming={status === "streaming"} />
      )}
      {error ? (
        <p className="px-4 pb-2 text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        model={pickedModel}
        onModelChange={setPickedModel}
        assistantId={resolvedAssistantId}
        onAssistantChange={setRecentAssistantId}
        showAssistantPicker={showAssistantPicker}
        inFlight={inFlight}
        canSend={canSend}
        onSend={handleSend}
        onStop={() => {
          void handleStop();
        }}
      />
    </div>
  );
}
