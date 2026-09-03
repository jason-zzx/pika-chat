"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

import {
  assistantKeys,
  useAssistantTree,
  useGenerateTopicTitle,
  useSetAssistantDefaultModel,
} from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
import InsetHeader from "@/components/layout/InsetHeader";
import { useAvailableModels } from "@/components/provider/use-available-models";
import { stopChatStream } from "@/lib/api/chat";
import { apiErrorMessage } from "@/lib/api/error-message";
import { assistantTopicHref } from "@/lib/assistant-path";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import { DEFAULT_TOPIC_TITLE } from "@/lib/schemas/topic";
import {
  composerDraftKey,
  useComposerStore,
  type ComposerModelPick,
} from "@/stores/composer-store";

import Composer from "./Composer";
import MessageList from "./MessageList";
import {
  findAvailableModel,
  pairFromIds,
  sameModelPick,
} from "./model-pick";
import { reasoningEffortRequestValue } from "./reasoning-effort";
import { resolveComposerModel } from "./resolve-composer-model";
import { shouldRequestTopicTitle } from "./should-request-topic-title";
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
  const models = useAvailableModels();
  const setAssistantDefault = useSetAssistantDefaultModel();
  const generateTitle = useGenerateTopicTitle();
  const generateTitleMutateRef = useRef(generateTitle.mutate);
  const history = useChatHistory(topicId);
  const chatId = topicId ?? "draft";
  const [createdTopicId, setCreatedTopicId] = useState<string | undefined>(
    undefined,
  );
  const activeTopicId = topicId ?? createdTopicId;
  const [streamId, setStreamId] = useState<string | null>(null);
  const [defaultModelError, setDefaultModelError] = useState<string | null>(
    null,
  );
  const seededHistoryFor = useRef<string | null>(null);
  const seededModel = useRef<string | null>(null);
  const titleRequestedRef = useRef(new Set<string>());
  const latestRef = useRef<{
    assistantId: string;
    topicId: string | undefined;
    shouldRequestTitle: boolean;
    titlePick: ComposerModelPick | null;
  }>({
    assistantId: assistantId ?? "",
    topicId,
    shouldRequestTitle: false,
    titlePick: null,
  });

  const setDraft = useComposerStore((state) => state.setDraft);
  const pickedModel = useComposerStore((state) => state.pickedModel);
  const setPickedModel = useComposerStore((state) => state.setPickedModel);
  const reasoningEffort = useComposerStore((state) => state.reasoningEffort);
  const setReasoningEffort = useComposerStore(
    (state) => state.setReasoningEffort,
  );
  const recentAssistantId = useComposerStore((state) => state.recentAssistantId);
  const setRecentAssistantId = useComposerStore(
    (state) => state.setRecentAssistantId,
  );

  const assistants = tree.data?.assistants ?? [];
  const resolvedAssistantId = assistantId ?? recentAssistantId ?? assistants[0]?.id;
  const draftKey = composerDraftKey(activeTopicId, resolvedAssistantId);
  const draft = useComposerStore((state) => state.drafts[draftKey] ?? "");
  const resolvedAssistant = assistants.find((row) => row.id === resolvedAssistantId);
  const showAssistantPicker = assistantId === undefined;
  const showChatTitle = Boolean(assistantId || activeTopicId);
  const headerTitle =
    (activeTopicId
      ? assistants
          .flatMap((assistant) => assistant.topics)
          .find((topic) => topic.id === activeTopicId)?.title
      : undefined) ??
    topicTitle ??
    DEFAULT_TOPIC_TITLE;

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
        setCreatedTopicId(part.data.topicId);
        setStreamId(part.data.streamId);
        void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
        const latest = latestRef.current;
        const requested = titleRequestedRef.current;
        if (
          latest.shouldRequestTitle &&
          latest.titlePick &&
          !requested.has(part.data.topicId)
        ) {
          requested.add(part.data.topicId);
          void generateTitleMutateRef.current({
            id: part.data.topicId,
            input: {
              providerConfigId: latest.titlePick.configId,
              modelId: latest.titlePick.modelId,
            },
          });
        }
        latest.shouldRequestTitle = false;
        const assistant = latest.assistantId;
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
    generateTitleMutateRef.current = generateTitle.mutate;
  }, [generateTitle.mutate]);

  useEffect(() => {
    if (assistantId) {
      setRecentAssistantId(assistantId);
    }
  }, [assistantId, setRecentAssistantId]);

  useEffect(() => {
    if (!topicId || !history.data || seededHistoryFor.current === topicId) {
      return;
    }
    seededHistoryFor.current = topicId;
    setMessages(history.data.messages);
  }, [history.data, setMessages, topicId]);

  useEffect(() => {
    const key = topicId ?? `draft:${resolvedAssistantId ?? "none"}`;
    if (topicId && history.isPending) {
      return;
    }
    if (models.data === undefined) {
      return;
    }
    if (!resolvedAssistant && tree.isPending) {
      return;
    }
    if (seededModel.current === key) {
      return;
    }
    const historyMessages = topicId ? (history.data?.messages ?? []) : [];
    const lastAssistant = [...historyMessages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.metadata?.providerConfigId &&
          message.metadata.modelId,
      );
    const fromHistory = topicId
      ? pairFromIds(
          lastAssistant?.metadata?.providerConfigId,
          lastAssistant?.metadata?.modelId,
        )
      : null;
    const fromAssistant = resolvedAssistant
      ? pairFromIds(
          resolvedAssistant.defaultProviderConfigId,
          resolvedAssistant.defaultModelId,
        )
      : pairFromIds(
          assistantDefaultProviderConfigId,
          assistantDefaultModelId,
        );
    seededModel.current = key;
    setPickedModel(
      resolveComposerModel({
        topicLastAssistantPair: fromHistory,
        assistantDefaultPair: fromAssistant,
        available: models.data,
      }),
    );
  }, [
    assistantDefaultModelId,
    assistantDefaultProviderConfigId,
    history.data?.messages,
    history.isPending,
    models.data,
    resolvedAssistant,
    resolvedAssistantId,
    setPickedModel,
    topicId,
    tree.isPending,
  ]);

  useEffect(() => {
    const selected = findAvailableModel(models.data, pickedModel);
    if (!selected?.reasoning) {
      if (reasoningEffort !== null) {
        setReasoningEffort(null);
      }
      return;
    }
    if (
      reasoningEffort !== null &&
      !selected.reasoningOptions.includes(reasoningEffort)
    ) {
      setReasoningEffort(null);
    }
  }, [
    models.data,
    pickedModel,
    reasoningEffort,
    setReasoningEffort,
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

  function handleModelChange(pick: ComposerModelPick | null) {
    const previous = pickedModel;
    const key = topicId ?? `draft:${resolvedAssistantId ?? "none"}`;
    seededModel.current = key;
    setPickedModel(pick);
    setDefaultModelError(null);
    if (!pick || !resolvedAssistantId || inFlight) {
      return;
    }
    const stored = pairFromIds(
      resolvedAssistant?.defaultProviderConfigId,
      resolvedAssistant?.defaultModelId,
    );
    if (sameModelPick(pick, stored)) {
      return;
    }
    setAssistantDefault.mutate(
      {
        id: resolvedAssistantId,
        defaultProviderConfigId: pick.configId,
        defaultModelId: pick.modelId,
      },
      {
        onError: (caught, variables) => {
          const current = useComposerStore.getState().pickedModel;
          if (
            current?.configId !== variables.defaultProviderConfigId ||
            current?.modelId !== variables.defaultModelId
          ) {
            return;
          }
          setPickedModel(previous);
          setDefaultModelError(
            apiErrorMessage(caught, "Unable to save default model"),
          );
        },
      },
    );
  }

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
      shouldRequestTitle: shouldRequestTopicTitle({
        activeTopicId,
        displayedTitle: headerTitle,
        requestedTopicIds: titleRequestedRef.current,
      }),
      titlePick: pickedModel,
    };
    const text = draft.trim();
    setDraft(draftKey, "");
    const selected = findAvailableModel(models.data, pickedModel);
    const effort = reasoningEffortRequestValue(selected, reasoningEffort);
    void sendMessage(
      { text },
      {
        body: {
          assistantId: resolvedAssistantId,
          topicId: activeTopicId,
          providerConfigId: pickedModel.configId,
          modelId: pickedModel.modelId,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        },
      },
    );
  }

  if (topicId && history.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <InsetHeader title={showChatTitle ? headerTitle : null} />
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
      <InsetHeader title={showChatTitle ? headerTitle : null} />
      {historyPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Loading conversation…
          </p>
        </div>
      ) : (
        <MessageList messages={messages} streaming={status === "streaming"} />
      )}
      {error ? (
        <p className="shrink-0 px-4 pb-2 text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      {defaultModelError ? (
        <p className="shrink-0 px-4 pb-2 text-sm text-destructive" role="alert">
          {defaultModelError}
        </p>
      ) : null}
      <Composer
        key={draftKey}
        draft={draft}
        onDraftChange={(value) => setDraft(draftKey, value)}
        model={pickedModel}
        onModelChange={handleModelChange}
        assistantId={resolvedAssistantId}
        onAssistantChange={setRecentAssistantId}
        showAssistantPicker={showAssistantPicker}
        inFlight={inFlight}
        modelPickerDisabled={
          setAssistantDefault.isPending ||
          (!resolvedAssistantId && tree.isPending)
        }
        canSend={canSend}
        onSend={handleSend}
        onStop={() => {
          void handleStop();
        }}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={setReasoningEffort}
      />
    </div>
  );
}
