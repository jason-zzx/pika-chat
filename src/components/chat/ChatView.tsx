"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DefaultChatTransport,
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type FileUIPart,
} from "ai";
import { useEffect, useRef, useState, type DragEvent } from "react";

import {
  assistantKeys,
  useAssistantTree,
  useGenerateTopicTitle,
  useSetAssistantDefaultModel,
} from "@/components/assistant/use-assistants";
import EmptyState from "@/components/common/EmptyState";
import InsetHeader from "@/components/layout/InsetHeader";
import { useAvailableModels } from "@/components/provider/use-available-models";
import { useModelPreferences } from "@/hooks/use-model-preferences";
import {
  deleteTopicMessage,
  listTopicMessages as fetchTopicMessages,
  regenerateTopicMessage,
  selectMessageVersion,
  stopChatStream,
  translateMessage,
} from "@/lib/api/chat";
import {
  apiErrorMessage,
  apiErrorMessageFromUnknown,
  isApiErrorEnvelope,
} from "@/lib/api/error-message";
import { compressTopic } from "@/lib/api/topic";
import {
  assistantTopicHref,
  parseAssistantPath,
} from "@/lib/assistant-path";
import type {
  ChatHistoryData,
  ChatUIMessage,
} from "@/lib/schemas/chat";
import { localTimeZone } from "@/lib/time-zone";
import type { TranslateTargetLanguageCode } from "@/lib/translate/languages";
import {
  composerDraftKey,
  useComposerStore,
  type ComposerModelPick,
  type StagedAttachment,
} from "@/stores/composer-store";

import { useComposerAttachments } from "./use-composer-attachments";
import ChatMapDialog from "./ChatMapDialog";
import Composer from "./Composer";
import ErrorBlock from "./ErrorBlock";
import MessageList, { type MessageListHandle } from "./MessageList";
import {
  buildRegenPlaceholder,
  insertRegenPlaceholder,
  removeRegenPlaceholder,
  upsertRegeneratedMessage,
  type RegenPlaceholderPlan,
  type RegenerateTargetRef,
} from "./regenerate-stream";
import { resolveServerMessageId } from "./sync-message";
import {
  findAvailableModel,
  pairFromIds,
  sameModelPick,
} from "./model-pick";
import { reasoningEffortRequestValue } from "./reasoning-effort";
import { imageRequestParams } from "./image-params";
import { resolveComposerModel } from "./resolve-composer-model";
import { shouldRequestTopicTitle } from "./should-request-topic-title";
import {
  chatKeys,
  topicKeys,
  useChatHistory,
  useTopicDetail,
} from "./use-chat-history";

// Stable fallback for drafts with no image params yet: a fresh `{}` per
// selector call would re-render on every unrelated store change.
const EMPTY_IMAGE_PARAMS = {};

function markLastAssistant(
  current: ChatUIMessage[],
  outcome: "stopped" | "failed",
  errorMessage?: string,
): ChatUIMessage[] {
  const last = current[current.length - 1];
  if (!last || last.role !== "assistant") {
    return current;
  }
  if (
    last.metadata?.outcome === outcome &&
    (errorMessage === undefined ||
      last.metadata.errorMessage === errorMessage)
  ) {
    return current;
  }
  return current.map((message, index) =>
    index === current.length - 1
      ? {
          ...message,
          metadata: {
            ...message.metadata,
            outcome,
            ...(errorMessage === undefined ? {} : { errorMessage }),
          },
        }
      : message,
  );
}

function markAssistantOutcome(
  current: ChatUIMessage[],
  messageId: string,
  outcome: "stopped" | "failed",
): ChatUIMessage[] {
  return current.map((message) =>
    message.id === messageId &&
    message.role === "assistant" &&
    message.metadata?.outcome !== outcome
      ? { ...message, metadata: { ...message.metadata, outcome } }
      : message,
  );
}

/**
 * Error surface above the composer, in the same container the transcript uses
 * for a failed turn. Covers both pre-stream failures (the request never opened
 * a stream, so there is no message to hang the error on) and failed actions.
 */
function ComposerError({ text }: { text: string }) {
  return (
    <div className="shrink-0 px-4 pb-2">
      {/* Same centred column as the transcript and the composer, so a long
          provider payload cannot run wider than the conversation above it. */}
      <div className="mx-auto w-full max-w-[52.5rem]">
        <ErrorBlock text={text} />
      </div>
    </div>
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
  const t = useTranslations("Chat.MessageList");
  const tChat = useTranslations("Chat");
  const tFiles = useTranslations("Files");
  const tErrors = useTranslations("Errors");
  const tree = useAssistantTree();
  const models = useAvailableModels();
  const modelPreferences = useModelPreferences();
  const setAssistantDefault = useSetAssistantDefaultModel();
  const generateTitle = useGenerateTopicTitle();
  const generateTitleMutateRef = useRef(generateTitle.mutate);
  const [createdTopicId, setCreatedTopicId] = useState<string | undefined>(
    undefined,
  );
  // B8: a topic created this session only reaches the URL via
  // history.replaceState, which does not re-render the route — topicId stays
  // undefined and a query keyed on it would never enable. Drive everything
  // that needs the effective topic off activeTopicId instead.
  const activeTopicId = topicId ?? createdTopicId;
  const pathname = usePathname();
  const history = useChatHistory(activeTopicId);
  const topicDetail = useTopicDetail(activeTopicId);
  const chatId = topicId ?? "draft";
  const [streamId, setStreamId] = useState<string | null>(null);
  const [regen, setRegen] = useState<{
    streamId: string | null;
    streamingId: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // In-flight translation (R5): shows a placeholder at the target message's
  // translation slot until the one-shot request resolves.
  const [translating, setTranslating] = useState<{
    messageId: string;
    targetLang: TranslateTargetLanguageCode;
  } | null>(null);
  // Manual history compression (PRD R2): in-flight flag disables the button
  // against double taps.
  const [compressing, setCompressing] = useState(false);
  // Bumped on every send so MessageList scrolls the new message to the top
  // of the viewport and pins follow-output auto-scroll for the reply.
  const [sendSignal, setSendSignal] = useState(0);
  // Chat map: the dialog lists every message and jumps to the chosen one
  // through this handle, so all scroll knowledge stays in MessageList.
  const messageListRef = useRef<MessageListHandle>(null);
  const [chatMapOpen, setChatMapOpen] = useState(false);
  // Whole-content-area drop zone (message list + composer): the enter/leave
  // counter keeps the overlay steady while the pointer crosses children —
  // dragenter/dragleave fire in pairs per element, so the zone is active
  // exactly while the counter is positive.
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [defaultModelError, setDefaultModelError] = useState<string | null>(
    null,
  );
  // Set when stop is pressed before the regenerate POST has returned its
  // stream id; the id is stopped as soon as it arrives (B5).
  const regenStopRequestedRef = useRef(false);
  const seededHistoryFor = useRef<string | null>(null);
  // Set once the replaceState'd URL of a session-created topic is visible to
  // the router (usePathname), so a later same-tree navigation away from it
  // can be told apart from the render before the patch applied.
  const urlShownForCreatedTopic = useRef<string | null>(null);
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
  const imageParams = useComposerStore(
    (state) => state.imageParams[draftKey] ?? EMPTY_IMAGE_PARAMS,
  );
  const setImageParams = useComposerStore((state) => state.setImageParams);
  const {
    attachments,
    addFiles,
    removeAttachment,
    retryAttachment,
    clearAttachments,
    restoreAttachments,
  } = useComposerAttachments(draftKey);
  // Attachments cleared on send are put back if the request fails, so the user
  // can switch model / retry without re-uploading.
  const pendingSendAttachments = useRef<{
    key: string;
    attachments: StagedAttachment[];
  } | null>(null);
  const resolvedAssistant = assistants.find((row) => row.id === resolvedAssistantId);
  // Once a session-created topic exists the topic's assistant is fixed; the
  // picker only belongs on a fresh draft. createdTopicId resets when the URL
  // leaves the topic, which restores the picker for the next draft.
  const showAssistantPicker =
    assistantId === undefined && activeTopicId === undefined;
  const headerTitle =
    (activeTopicId
      ? assistants
          .flatMap((assistant) => assistant.topics)
          .find((topic) => topic.id === activeTopicId)?.title
      : undefined) ??
    topicTitle ??
    tChat("newTopic");
  const headerModel = findAvailableModel(models.data, pickedModel);
  const headerSubtitle = headerModel
    ? `${headerModel.modelId} · ${headerModel.configName}`
    : null;

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

  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    clearError,
  } =
    useChat<ChatUIMessage>({
      id: chatId,
      transport,
      onData: (part) => {
        if (part.type !== "data-topic") {
          return;
        }
        latestRef.current.topicId = part.data.topicId;
        setCreatedTopicId(part.data.topicId);
        // B8: the live local stream is newer than anything the just-enabled
        // history query can return for the new topic; mark it as already
        // seeded so the mid-session fetch cannot clobber the stream. Later
        // explicit reseeds (regen/delete/select) clear this ref first.
        seededHistoryFor.current = part.data.topicId;
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
        // Pass null, not window.history.state: Next's history patch treats
        // state carrying its __NA marker as an internal call and skips
        // syncing the router (canonicalUrl would stay on the draft URL and
        // New topic would become a same-page no-op). With null the patch
        // copies the internals over itself and adopts the topic URL.
        window.history.replaceState(
          null,
          "",
          assistantTopicHref(assistant, part.data.topicId),
        );
      },
      onFinish: (event) => {
        const pending = pendingSendAttachments.current;
        if (pending && event.isError) {
          restoreAttachments(pending.key, pending.attachments);
        }
        pendingSendAttachments.current = null;
        const topic = latestRef.current.topicId;
        void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
        if (topic) {
          // A failed turn is stamped locally so the failure shows at once, but
          // the reason lives in the persisted row. Clearing the seed guard
          // lets the refetch below replace it, so the live view shows the same
          // error a reload would instead of the generic fallback. The server
          // persists in its own onEnd, which runs before the response stream
          // closes — by the time this fires the row is already there.
          if (event.isError) {
            seededHistoryFor.current = null;
          }
          void queryClient.invalidateQueries({
            queryKey: chatKeys.history(topic),
          });
          // The send may have auto-compressed the history server-side (PRD
          // R1); refresh the detail so the marker reflects the new boundary.
          void queryClient.invalidateQueries({
            queryKey: topicKeys.detail(topic),
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
    if (createdTopicId === undefined) {
      return;
    }
    if (parseAssistantPath(pathname).topicId === createdTopicId) {
      urlShownForCreatedTopic.current = createdTopicId;
      return;
    }
    if (urlShownForCreatedTopic.current !== createdTopicId) {
      return;
    }
    // The URL pointed at the session-created topic and no longer does. The
    // router still holds the draft route tree (the topic id only reached the
    // URL via history.replaceState), so navigating to the draft URL — the
    // New topic button, or deleting this topic and being routed to a fresh
    // draft — diffs to the same tree and does not remount this view. Reset
    // to a clean draft state instead of showing the old topic's messages.
    urlShownForCreatedTopic.current = null;
    setCreatedTopicId(undefined);
    setStreamId(null);
    setMessages([]);
    seededHistoryFor.current = null;
  }, [pathname, createdTopicId, setMessages]);

  useEffect(() => {
    if (
      !activeTopicId ||
      !history.data ||
      seededHistoryFor.current === activeTopicId
    ) {
      return;
    }
    seededHistoryFor.current = activeTopicId;
    setMessages(history.data.messages);
  }, [history.data, setMessages, activeTopicId]);

  useEffect(() => {
    const key = topicId ?? `draft:${resolvedAssistantId ?? "none"}`;
    if (topicId && history.isPending) {
      return;
    }
    if (models.data === undefined) {
      return;
    }
    if (modelPreferences.isPending) {
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
    const fromUserDefault = pairFromIds(
      modelPreferences.data?.chat?.providerConfigId,
      modelPreferences.data?.chat?.modelId,
    );
    seededModel.current = key;
    setPickedModel(
      resolveComposerModel({
        topicLastAssistantPair: fromHistory,
        assistantDefaultPair: fromAssistant,
        userDefaultPair: fromUserDefault,
        available: models.data,
      }),
    );
  }, [
    assistantDefaultModelId,
    assistantDefaultProviderConfigId,
    history.data?.messages,
    history.isPending,
    modelPreferences.data,
    modelPreferences.isPending,
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

  // A stream failure arrives as plain text — the sanitized provider detail the
  // server also persisted — so the transcript can show the real reason at once.
  // A pre-stream failure carries our JSON envelope instead, and belongs to the
  // composer banner below; stamping its body onto the message would put raw
  // envelope JSON in the transcript.
  const streamErrorMessage =
    error instanceof Error && !isApiErrorEnvelope(error)
      ? error.message
      : undefined;

  useEffect(() => {
    if (status !== "error") {
      return;
    }
    setMessages((current) =>
      markLastAssistant(current, "failed", streamErrorMessage),
    );
  }, [setMessages, status, streamErrorMessage]);

  // The transcript is where a failed turn shows its reason. Once it is rendered
  // there the latched send error has nothing left to say, and dropping it stops
  // it resurfacing later — the latch is otherwise never cleared, and a
  // regenerate swaps the failed message for an outcome-less placeholder, which
  // used to make the stale error flash as a composer banner mid-request.
  //
  // A failed turn already carries its reason in the transcript, so repeating it
  // above the composer is noise; this also gates the banner below. A pre-stream
  // failure leaves no message behind, so its banner stays the only feedback.
  const lastMessage = messages[messages.length - 1];
  const failureShownInTranscript =
    lastMessage?.role === "assistant" &&
    lastMessage.metadata?.outcome === "failed";

  useEffect(() => {
    if (error !== undefined && failureShownInTranscript) {
      clearError();
    }
  }, [error, failureShownInTranscript, clearError]);

  const inFlight =
    status === "submitted" || status === "streaming" || regen !== null;
  // Image mode mirrors the composer: an image-output model takes a prompt
  // only — no attachments, search mode, or reasoning effort.
  const pickedModelEntry = findAvailableModel(models.data, pickedModel);
  const imageMode =
    pickedModelEntry?.outputModalities.includes("image") ?? false;
  // Only `ready` attachments are sent; while anything is uploading (or failed)
  // sending is held back so the user never silently drops an attachment.
  const readyAttachments = attachments.filter(
    (attachment): attachment is StagedAttachment & { url: string } =>
      attachment.status === "ready" && attachment.url !== undefined,
  );
  const attachmentsSettled = attachments.every(
    (attachment) => attachment.status === "ready",
  );
  const canSend =
    (imageMode
      ? draft.trim().length > 0
      : draft.trim().length > 0 || readyAttachments.length > 0) &&
    (imageMode || attachmentsSettled) &&
    Boolean(resolvedAssistantId) &&
    Boolean(pickedModel) &&
    !inFlight &&
    (!topicId || history.isSuccess);
  // Delete/select do not need a model; regenerate paths check pickedModel
  // themselves (a user without providers must still be able to delete).
  const canActOnMessages =
    !inFlight && Boolean(activeTopicId) && (!topicId || history.isSuccess);

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
            apiErrorMessage(caught, tErrors, "actions.saveDefaultModel"),
          );
        },
      },
    );
  }

  async function handleStop() {
    if (regen) {
      if (regen.streamId) {
        try {
          await stopChatStream(regen.streamId);
        } catch {
          // Unknown or already finished streams are NOT_FOUND.
        }
      } else {
        // The regenerate POST has not returned a stream id yet; stop it as
        // soon as runRegeneration receives one.
        regenStopRequestedRef.current = true;
      }
      if (regen.streamingId.length > 0) {
        setMessages((current) =>
          markAssistantOutcome(current, regen.streamingId, "stopped"),
        );
      }
      // The server ends the stream; runRegeneration's teardown reseeds.
      return;
    }
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

  /**
   * Resync the message list from the server. Must run only after any stream
   * has fully ended (including server-side persistence): clearing
   * seededHistoryFor re-arms the seed effect, and the next history refetch
   * replaces local messages with the persisted selected-version view.
   */
  function reseedHistory(topic: string) {
    seededHistoryFor.current = null;
    void queryClient.invalidateQueries({ queryKey: chatKeys.history(topic) });
  }

  /** Fresh (never cached) history for the B6 persistence-race guard. */
  function fetchFreshHistoryMessages(topic: string) {
    return queryClient
      .fetchQuery({
        queryKey: chatKeys.history(topic),
        queryFn: () => fetchTopicMessages(topic),
      })
      .then((response) => response.messages);
  }

  /**
   * B6: a freshly streamed reply may still be mid-persistence server-side
   * (stop/abort releases the client before onEnd finishes); confirm the id
   * is known before acting so the action cannot hit a spurious 404. On
   * failure, surface a retryable error and reseed from the server; the
   * caller handles any site-specific cleanup on the null path.
   */
  async function ensureServerMessageId(
    message: ChatUIMessage,
    topic: string,
  ): Promise<string | null> {
    const serverId = await resolveServerMessageId({
      message,
      fetchHistory: () => fetchFreshHistoryMessages(topic),
    });
    if (!serverId) {
      setActionError(t("stillSaving"));
      reseedHistory(topic);
      return null;
    }
    return serverId;
  }

  async function runRegeneration(
    topic: string,
    target: RegenerateTargetRef,
    targetIndex: number,
    pick: ComposerModelPick,
    plan: RegenPlaceholderPlan | null,
  ) {
    const failStart = (caught?: unknown) => {
      // The stream never started: nothing changed server-side, so put the
      // replaced version back instead of leaving an orphan placeholder (B5).
      if (plan) {
        setMessages((current) => removeRegenPlaceholder(current, plan));
      }
      setRegen(null);
      setActionError(
        caught === undefined
          ? tErrors("actions.regenerate")
          : apiErrorMessage(caught, tErrors, "actions.regenerate"),
      );
      reseedHistory(topic);
    };
    const selected = findAvailableModel(models.data, pick);
    const effort = reasoningEffortRequestValue(selected, reasoningEffort);
    // Regeneration inherits the composer's current search mode, matching the
    // existing rule that it uses the composer's current model and effort.
    const searchMode = useComposerStore.getState().searchMode;
    // Same inheritance for image mode: the current draft's imageParams,
    // sanitized against the regenerated pick's capability table. Non-image
    // models (and a fully-stale sanitize) omit the key.
    const image = selected?.outputModalities.includes("image")
      ? imageRequestParams(
          useComposerStore.getState().imageParams[draftKey] ??
            EMPTY_IMAGE_PARAMS,
          pick.modelId,
        )
      : undefined;
    let response: Response;
    try {
      response = await regenerateTopicMessage(topic, target.id, {
        providerConfigId: pick.configId,
        modelId: pick.modelId,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
        searchMode,
        ...(image ? { image } : {}),
        timeZone: localTimeZone(),
      });
    } catch (caught) {
      failStart(caught);
      return;
    }
    if (!response.body) {
      failStart();
      return;
    }
    const regenStreamId = response.headers.get("x-pika-stream-id");
    setRegen({
      streamId: regenStreamId,
      streamingId: plan?.placeholder.id ?? "",
    });
    if (regenStopRequestedRef.current) {
      regenStopRequestedRef.current = false;
      if (regenStreamId) {
        try {
          await stopChatStream(regenStreamId);
        } catch {
          // Unknown or already finished streams are NOT_FOUND.
        }
      }
    }
    try {
      const chunkStream = parseJsonEventStream({
        stream: response.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (!chunk.success) {
              throw chunk.error;
            }
            controller.enqueue(chunk.value);
          },
        }),
      );
      const messageStream = readUIMessageStream<ChatUIMessage>({
        stream: chunkStream,
      });
      for await (const next of messageStream) {
        setRegen({ streamId: regenStreamId, streamingId: next.id });
        setMessages((current) =>
          upsertRegeneratedMessage(
            current,
            next,
            target,
            targetIndex,
            plan ?? undefined,
          ),
        );
      }
    } catch {
      // A broken stream still persists a version server-side (stopped/failed
      // outcome); the teardown resync below shows it.
    } finally {
      setRegen(null);
      regenStopRequestedRef.current = false;
      void queryClient.invalidateQueries({ queryKey: assistantKeys.tree() });
      reseedHistory(topic);
    }
  }

  async function handleRegenerate(message: ChatUIMessage) {
    if (!canActOnMessages || !pickedModel || !activeTopicId) {
      return;
    }
    setActionError(null);
    const topic = activeTopicId;
    const pick = pickedModel;
    const index = messages.findIndex((entry) => entry.id === message.id);
    const target: RegenerateTargetRef = {
      id: message.id,
      role: message.role === "assistant" ? "assistant" : "user",
    };
    // Show the thinking shimmer immediately (R7): swap the answer being
    // regenerated for an empty streaming placeholder before the request
    // round-trips, instead of waiting for the first stream frame.
    const plan = buildRegenPlaceholder(messages, target, index);
    if (plan) {
      setMessages((current) => insertRegenPlaceholder(current, plan));
    }
    regenStopRequestedRef.current = false;
    setRegen({ streamId: null, streamingId: plan?.placeholder.id ?? "" });
    const serverId = await ensureServerMessageId(message, topic);
    if (!serverId) {
      if (plan) {
        setMessages((current) => removeRegenPlaceholder(current, plan));
      }
      setRegen(null);
      return;
    }
    await runRegeneration(
      topic,
      { id: serverId, role: target.role },
      index,
      pick,
      plan,
    );
  }

  async function handleDelete(message: ChatUIMessage) {
    if (!canActOnMessages || !activeTopicId) {
      return;
    }
    setActionError(null);
    const serverId = await ensureServerMessageId(message, activeTopicId);
    if (!serverId) {
      return;
    }
    try {
      await deleteTopicMessage(activeTopicId, serverId);
    } catch (caught) {
      setActionError(apiErrorMessage(caught, tErrors, "actions.deleteMessage"));
      return;
    }
    setMessages((current) =>
      current.filter((entry) => entry.id !== message.id),
    );
    reseedHistory(activeTopicId);
  }

  /**
   * PRD 消息翻译： one-shot server translation with the composer's current
   * model. The result merges into the live message list and the React Query
   * history cache in place — no list refetch (the server already persisted
   * it on the message row; a later reseed reads it back).
   */
  async function handleTranslate(
    message: ChatUIMessage,
    targetLang: TranslateTargetLanguageCode,
  ) {
    if (!canActOnMessages || !pickedModel || !activeTopicId) {
      return;
    }
    // Already translated — the server cache is the backstop for the window
    // between the request and the local merge below.
    if (message.metadata?.translations?.[targetLang] !== undefined) {
      return;
    }
    setActionError(null);
    const topic = activeTopicId;
    const pick = pickedModel;
    const serverId = await ensureServerMessageId(message, topic);
    if (!serverId) {
      return;
    }
    // Cleared only when it still describes this request: a second translation
    // started meanwhile must keep its own placeholder. React batches this
    // with the merge below, so there is no gap between placeholder and text.
    const clearTranslating = () =>
      setTranslating((current) =>
        current?.messageId === serverId && current.targetLang === targetLang
          ? null
          : current,
      );
    setTranslating({ messageId: serverId, targetLang });
    let translation: string;
    try {
      ({ translation } = await translateMessage({
        messageId: serverId,
        targetLang,
        providerConfigId: pick.configId,
        modelId: pick.modelId,
      }));
    } catch (caught) {
      setActionError(apiErrorMessage(caught, tErrors, "actions.translate"));
      return;
    } finally {
      clearTranslating();
    }
    const mergeTranslation = (
      entry: ChatUIMessage,
      id: string,
    ): ChatUIMessage =>
      entry.id === id
        ? {
            ...entry,
            metadata: {
              ...entry.metadata,
              translations: {
                ...entry.metadata?.translations,
                [targetLang]: translation,
              },
            },
          }
        : entry;
    setMessages((current) =>
      current.map((entry) => mergeTranslation(entry, message.id)),
    );
    queryClient.setQueryData<ChatHistoryData | undefined>(
      chatKeys.history(topic),
      (data) =>
        data
          ? {
              messages: data.messages.map((entry) =>
                mergeTranslation(entry, serverId),
              ),
            }
          : data,
    );
  }

  async function handleSelectVersion(
    message: ChatUIMessage,
    versionId: string,
  ) {
    if (!canActOnMessages || !activeTopicId || versionId === message.id) {
      return;
    }
    setActionError(null);
    const serverId = await ensureServerMessageId(message, activeTopicId);
    if (!serverId) {
      return;
    }
    try {
      await selectMessageVersion(activeTopicId, versionId);
    } catch (caught) {
      setActionError(apiErrorMessage(caught, tErrors, "actions.switchVersions"));
      return;
    }
    // No optimistic switch: the reseeded history shows the new selection.
    reseedHistory(activeTopicId);
  }

  async function handleDeleteRegenerate(message: ChatUIMessage) {
    if (
      !canActOnMessages ||
      !pickedModel ||
      !activeTopicId ||
      message.role !== "assistant"
    ) {
      return;
    }
    setActionError(null);
    const topic = activeTopicId;
    const pick = pickedModel;
    const index = messages.findIndex((entry) => entry.id === message.id);
    const remaining = (message.metadata?.versionIds ?? []).filter(
      (id) => id !== message.id,
    );
    // Resolve the regenerate target before mutating anything: the newest
    // remaining version of the group, or — when the deleted version was the
    // only one — the nearest preceding user message (its "no following
    // answer" branch creates a fresh answer slot server-side).
    let target: RegenerateTargetRef | null = null;
    let targetIndex = index;
    const latestRemaining = remaining[remaining.length - 1];
    if (latestRemaining !== undefined) {
      target = { id: latestRemaining, role: "assistant" };
    } else {
      const end = index < 0 ? messages.length : index;
      for (let i = end - 1; i >= 0; i -= 1) {
        const candidate = messages[i];
        if (candidate?.role === "user") {
          target = { id: candidate.id, role: "user" };
          targetIndex = i;
          break;
        }
      }
    }
    // B6 guard, as in handleRegenerate: confirm the delete target is known
    // server-side before mutating.
    const serverId = await ensureServerMessageId(message, topic);
    if (!serverId) {
      return;
    }
    try {
      await deleteTopicMessage(topic, serverId);
    } catch (caught) {
      setActionError(apiErrorMessage(caught, tErrors, "actions.deleteMessage"));
      return;
    }
    const afterDelete = messages.filter((entry) => entry.id !== message.id);
    setMessages(afterDelete);
    if (!target) {
      reseedHistory(topic);
      return;
    }
    // Same immediate-shimmer contract as handleRegenerate (R7): swap the
    // answer slot the regeneration will take over for an empty placeholder.
    const plan = buildRegenPlaceholder(afterDelete, target, targetIndex);
    if (plan) {
      setMessages((current) => insertRegenPlaceholder(current, plan));
    }
    regenStopRequestedRef.current = false;
    setRegen({ streamId: null, streamingId: plan?.placeholder.id ?? "" });
    // The delete is already applied; if regeneration fails to start, the
    // error is surfaced without rolling the delete back.
    await runRegeneration(topic, target, targetIndex, pick, plan);
  }

  async function handleCompress() {
    if (
      !canActOnMessages ||
      !pickedModel ||
      !activeTopicId ||
      compressing
    ) {
      return;
    }
    setActionError(null);
    setCompressing(true);
    try {
      await compressTopic(activeTopicId, {
        providerConfigId: pickedModel.configId,
        modelId: pickedModel.modelId,
      });
      // The boundary moved: refresh the detail query so the compression marker
      // renders after the new boundary message. History itself is untouched.
      // Awaited on purpose — clearing the in-flight shimmer first would leave a
      // visible gap where the divider has not arrived yet.
      await queryClient.invalidateQueries({
        queryKey: topicKeys.detail(activeTopicId),
      });
    } catch (caught) {
      setActionError(apiErrorMessage(caught, tErrors, "actions.compress"));
    } finally {
      setCompressing(false);
    }
  }

  function isFileDrag(event: DragEvent<HTMLElement>): boolean {
    return event.dataTransfer.types.includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    // The composer is inert while a turn streams (paperclip, textarea and the
    // drop handler itself all refuse input), so do not invite a drop that
    // would be silently ignored. Image mode takes no attachments either.
    if (inFlight || imageMode) {
      return;
    }
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    // Required so the drop is allowed; non-file drags (e.g. text selection)
    // keep their default behavior and never show the overlay.
    if (isFileDrag(event)) {
      event.preventDefault();
    }
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (inFlight || imageMode) {
      return;
    }
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      addFiles(Array.from(files));
    }
  }

  // Close first, then scroll on the next frame: the dialog's exit animation
  // still holds the layout (and scroll lock) during this commit.
  function handleSelectMessage(key: string) {
    setChatMapOpen(false);
    requestAnimationFrame(() => messageListRef.current?.scrollToMessage(key));
  }

  function handleSend() {
    if (!canSend || !pickedModel || !resolvedAssistantId) {
      return;
    }
    setSendSignal((count) => count + 1);
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
    // Image mode never sends attachments (the server rejects them); staged
    // chips stay put so switching back to a chat model restores them.
    const outgoingFiles: FileUIPart[] = imageMode
      ? []
      : readyAttachments.map((attachment) => ({
          type: "file",
          url: attachment.url,
          mediaType: attachment.mediaType,
          filename: attachment.filename,
        }));
    pendingSendAttachments.current =
      outgoingFiles.length > 0
        ? { key: draftKey, attachments: readyAttachments }
        : null;
    // Clear the chips now that the message owns them; onFinish puts them back
    // if the request failed.
    if (outgoingFiles.length > 0) {
      clearAttachments(draftKey);
    }
    setDraft(draftKey, "");
    const selected = findAvailableModel(models.data, pickedModel);
    const effort = imageMode
      ? undefined
      : reasoningEffortRequestValue(selected, reasoningEffort);
    const searchMode = useComposerStore.getState().searchMode;
    // Only params the user actually set ride along, sanitized against the
    // selected model's capability table (stale picks from a previous image
    // family are dropped); the provider default covers the rest.
    const image = imageMode
      ? imageRequestParams(imageParams, pickedModel.modelId)
      : undefined;
    const body = {
      assistantId: resolvedAssistantId,
      topicId: activeTopicId,
      providerConfigId: pickedModel.configId,
      modelId: pickedModel.modelId,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      ...(imageMode ? {} : { searchMode }),
      ...(image ? { image } : {}),
      timeZone: localTimeZone(),
    };
    const metadata = { createdAt: new Date().toISOString() };
    // The AI SDK's no-text overload omits the empty text part an attachment-only
    // message would otherwise carry.
    if (text.length > 0) {
      void sendMessage(
        {
          text,
          ...(outgoingFiles.length > 0 ? { files: outgoingFiles } : {}),
          metadata,
        },
        { body },
      );
    } else {
      void sendMessage({ files: outgoingFiles, metadata }, { body });
    }
  }

  if (topicId && history.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <InsetHeader title={headerTitle} subtitle={headerSubtitle} />
        <EmptyState
          title={t("loadFailedTitle")}
          description={t("loadFailedDescription")}
        />
      </div>
    );
  }

  const historyPending = Boolean(topicId) && history.isPending;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleFileDrop}
    >
      <InsetHeader title={headerTitle} subtitle={headerSubtitle} />
      {historyPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      ) : (
        <MessageList
          ref={messageListRef}
          messages={messages}
          streaming={status === "streaming" || regen !== null}
          streamingMessageId={
            regen && regen.streamingId.length > 0 ? regen.streamingId : undefined
          }
          sendSignal={sendSignal}
          assistantName={resolvedAssistant?.name}
          assistantIcon={resolvedAssistant?.icon}
          onRegenerate={(message) => void handleRegenerate(message)}
          onDelete={(message) => void handleDelete(message)}
          onDeleteRegenerate={(message) => void handleDeleteRegenerate(message)}
          onSelectVersion={(message, versionId) =>
            void handleSelectVersion(message, versionId)
          }
          onTranslate={
            pickedModel
              ? (message, targetLang) => void handleTranslate(message, targetLang)
              : undefined
          }
          translating={translating}
          compression={{
            upToMessageId: topicDetail.data?.summaryUpToMessageId ?? null,
            upToGroupId: topicDetail.data?.summaryUpToGroupId ?? null,
            summaryText: topicDetail.data?.summaryText ?? null,
            inProgress: compressing,
          }}
        />
      )}
      {error && !failureShownInTranscript ? (
        <ComposerError
          text={apiErrorMessageFromUnknown(error, tErrors, "actions.sendMessage")}
        />
      ) : null}
      {actionError ? <ComposerError text={actionError} /> : null}
      {defaultModelError ? <ComposerError text={defaultModelError} /> : null}
      {dragActive ? (
        // Decorative, transient feedback for pointer users; the labelled
        // attach button is the keyboard/screen-reader path.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 m-2 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/40 bg-background/80"
        >
          <p className="text-sm font-medium text-foreground">
            {tFiles("dropHint")}
          </p>
        </div>
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
        onOpenChatMap={() => setChatMapOpen(true)}
        chatMapDisabled={messages.length === 0}
        onCompress={() => void handleCompress()}
        compressDisabled={
          !activeTopicId ||
          !pickedModel ||
          inFlight ||
          compressing ||
          // Nothing to fold in: an empty topic would only 400 server-side.
          messages.length === 0
        }
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
        onRetryAttachment={retryAttachment}
        imageParams={imageParams}
        onImageParamsChange={(next) => setImageParams(draftKey, next)}
      />
      <ChatMapDialog
        open={chatMapOpen}
        onOpenChange={setChatMapOpen}
        messages={messages}
        onSelect={handleSelectMessage}
      />
    </div>
  );
}
