import "server-only";

import type { UIMessageChunk } from "ai";

import type {
  ChatDataParts,
  ChatMetadata,
  ChatUIMessage,
} from "@/lib/schemas/chat";
import { withReasoningDurations } from "@/server/ai/reasoning-timer";

/**
 * Current-state assembly for a server-managed generation (chat task §2/§6).
 *
 * The producer holds ONE continuously updated copy of the answer being
 * generated — never a history of snapshots or raw provider events. Two things
 * read that copy:
 *
 * - the checkpoint writer, which periodically persists it so a process crash
 *   keeps the partial answer (R9);
 * - a reconnecting subscriber, which receives the copy serialized back into
 *   standard UI-message chunks before the live chunks continue (R3).
 *
 * The serialization is protocol adaptation, not SDK state injection: every
 * chunk emitted here is one the SDK's own reducer accepts for the part types
 * this app actually produces (text, reasoning, tool, source, file, data,
 * metadata).
 */

type Part = ChatUIMessage["parts"][number];
export type ChatChunk = UIMessageChunk<ChatMetadata, ChatDataParts>;

export type LiveMessageState = {
  id: string;
  parts: Part[];
  metadata: ChatMetadata;
};

export type LiveStreamState = {
  generationId: string;
  userId: string;
  topicId: string | null;
  assistantMessageId: string;
  /** Whether this turn announces its topic via a `data-topic` chunk (sends
   * do; regenerations already know their topic and must not add one). */
  announceTopic: boolean;
  message: LiveMessageState;
  /** SDK part ids of text parts (text parts persist no id, so the id lives
   * only here) keyed by part index. Reasoning parts carry their own id. */
  partIds: Map<number, string>;
  /** Part indexes whose stream is still open (text/reasoning/tool input). */
  open: Set<number>;
  /** Raw streaming tool-input text per toolCallId. Kept verbatim: a partial
   * JSON object cannot be re-serialized and continued reliably. */
  toolRaw: Map<string, string>;
  toolIndex: Map<string, number>;
  /** Tool names seen for each call id, so a part that only ever appears as a
   * finished `tool-input-available` (provider-executed tools emit no
   * `tool-input-start`) can still be materialized and replayed. */
  toolNames: Map<string, string>;
  /** Set when anything changed since the last checkpoint write. */
  dirty: boolean;
};

export function createLiveStreamState(input: {
  generationId: string;
  userId: string;
  topicId: string | null;
  assistantMessageId: string;
  metadata?: ChatMetadata;
  announceTopic?: boolean;
}): LiveStreamState {
  return {
    generationId: input.generationId,
    userId: input.userId,
    topicId: input.topicId,
    assistantMessageId: input.assistantMessageId,
    announceTopic: input.announceTopic ?? true,
    message: {
      id: input.assistantMessageId,
      parts: [],
      metadata: { ...input.metadata },
    },
    partIds: new Map(),
    open: new Set(),
    toolRaw: new Map(),
    toolIndex: new Map(),
    toolNames: new Map(),
    dirty: false,
  };
}

function toolCallIdOf(part: Part): string | undefined {
  return "toolCallId" in part ? part.toolCallId : undefined;
}

function mergeMetadata(
  state: LiveStreamState,
  metadata: ChatMetadata | undefined,
): void {
  if (!metadata) {
    return;
  }
  state.message.metadata = { ...state.message.metadata, ...metadata };
}

/** Best-effort JSON parse of a partial tool input; `undefined` while the
 * streamed text is not yet parseable JSON. */
function parsePartialJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Applies one UI-message chunk to the live state. Must stay synchronous: a
 * subscriber that captures the state and registers itself in the same turn
 * relies on no chunk being applied in between.
 */
export function applyChunk(state: LiveStreamState, chunk: ChatChunk): void {
  switch (chunk.type) {
    case "start": {
      if (chunk.messageId) {
        state.message.id = chunk.messageId;
      }
      mergeMetadata(state, chunk.messageMetadata);
      return;
    }
    case "start-step": {
      state.message.parts.push({ type: "step-start" });
      break;
    }
    case "text-start": {
      const index = state.message.parts.length;
      state.message.parts.push({ type: "text", text: "" });
      state.partIds.set(index, chunk.id);
      state.open.add(index);
      break;
    }
    case "text-delta": {
      const index = indexOfOpenPart(state, chunk.id, "text");
      const part = state.message.parts[index];
      if (part && part.type === "text") {
        part.text += chunk.delta;
      }
      break;
    }
    case "text-end": {
      const index = indexOfOpenPart(state, chunk.id, "text");
      state.open.delete(index);
      break;
    }
    case "reasoning-start": {
      const index = state.message.parts.length;
      state.message.parts.push({
        type: "reasoning",
        text: "",
        id: chunk.id,
      });
      state.partIds.set(index, chunk.id);
      state.open.add(index);
      break;
    }
    case "reasoning-delta": {
      const index = indexOfOpenPart(state, chunk.id, "reasoning");
      const part = state.message.parts[index];
      if (part && part.type === "reasoning") {
        part.text += chunk.delta;
      }
      break;
    }
    case "reasoning-end": {
      const index = indexOfOpenPart(state, chunk.id, "reasoning");
      state.open.delete(index);
      break;
    }
    case "tool-input-start": {
      const index = ensureToolPart(state, chunk.toolCallId, chunk.toolName);
      if (chunk.providerExecuted !== undefined) {
        (state.message.parts[index] as { providerExecuted?: boolean })
          .providerExecuted = chunk.providerExecuted;
      }
      state.toolRaw.set(chunk.toolCallId, "");
      state.open.add(index);
      break;
    }
    case "tool-input-delta": {
      const raw = (state.toolRaw.get(chunk.toolCallId) ?? "") +
        chunk.inputTextDelta;
      state.toolRaw.set(chunk.toolCallId, raw);
      const index = state.toolIndex.get(chunk.toolCallId);
      const parsed = parsePartialJson(raw);
      if (index !== undefined && parsed !== undefined) {
        const part = state.message.parts[index];
        if (part && "input" in part) {
          (part as { input?: unknown }).input = parsed;
        }
      }
      break;
    }
    case "tool-input-available": {
      ensureToolPart(
        state,
        chunk.toolCallId,
        chunk.toolName,
        chunk.providerExecuted,
      );
      updateToolPart(state, chunk.toolCallId, (part) => {
        const next = part as {
          state?: string;
          input?: unknown;
          errorText?: string;
        };
        next.state = "input-available";
        next.input = chunk.input;
        delete next.errorText;
      });
      closeToolInput(state, chunk.toolCallId);
      break;
    }
    case "tool-input-error": {
      ensureToolPart(
        state,
        chunk.toolCallId,
        chunk.toolName,
        chunk.providerExecuted,
      );
      updateToolPart(state, chunk.toolCallId, (part) => {
        const next = part as {
          state?: string;
          input?: unknown;
          errorText?: string;
        };
        next.state = "output-error";
        next.input = chunk.input;
        next.errorText = chunk.errorText;
      });
      closeToolInput(state, chunk.toolCallId);
      break;
    }
    case "tool-output-available": {
      updateToolPart(state, chunk.toolCallId, (part) => {
        const next = part as { state?: string; output?: unknown };
        next.state = "output-available";
        next.output = chunk.output;
      });
      closeToolInput(state, chunk.toolCallId);
      break;
    }
    case "tool-output-error": {
      updateToolPart(state, chunk.toolCallId, (part) => {
        const next = part as {
          state?: string;
          errorText?: string;
          output?: unknown;
        };
        next.state = "output-error";
        next.errorText = chunk.errorText;
        delete next.output;
      });
      closeToolInput(state, chunk.toolCallId);
      break;
    }
    case "source-url": {
      state.message.parts.push({
        type: "source-url",
        sourceId: chunk.sourceId,
        url: chunk.url,
        ...(chunk.title === undefined ? {} : { title: chunk.title }),
      } as unknown as Part);
      break;
    }
    case "source-document": {
      state.message.parts.push({
        type: "source-document",
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        ...(chunk.filename === undefined ? {} : { filename: chunk.filename }),
      } as unknown as Part);
      break;
    }
    case "file":
    case "reasoning-file": {
      state.message.parts.push({
        type: "file",
        url: chunk.url,
        mediaType: chunk.mediaType,
      });
      break;
    }
    case "message-metadata": {
      mergeMetadata(state, chunk.messageMetadata);
      // Closed reasoning phases must survive a checkpoint/stop too, not only
      // a finish chunk (which never arrives on a disconnected provider).
      zipReasoningDurations(state);
      break;
    }
    case "finish": {
      // Usage/finish metadata rides in `messageMetadata` and is the single
      // source for persistence and replay (no duplicated scalar fields).
      mergeMetadata(state, chunk.messageMetadata);
      // Per-phase reasoning durations live in metadata but render from the
      // parts, so zip them in here — the one place that assembles the message.
      zipReasoningDurations(state);
      break;
    }
    case "error": {
      // The stream-failure tracker decides the turn outcome; the message
      // state itself gets nothing (the SDK renders the error separately).
      break;
    }
    default: {
      // Framing/data chunks (data-topic, finish-step, abort, …) carry no
      // message part of their own.
      break;
    }
  }
  state.dirty = true;
}

/**
 * Index of the open part with the given SDK id. Falls back to opening a part
 * if the id is unknown (a resumed producer never should, but a dropped
 * `text-start` must not wedge the whole turn).
 */
function indexOfOpenPart(
  state: LiveStreamState,
  id: string,
  kind: "text" | "reasoning",
): number {
  for (const [index, partId] of state.partIds) {
    if (partId !== id) {
      continue;
    }
    const part = state.message.parts[index];
    if (part && part.type === kind) {
      return index;
    }
  }
  const index = state.message.parts.length;
  state.message.parts.push(
    kind === "text"
      ? { type: "text", text: "" }
      : { type: "reasoning", text: "", id },
  );
  state.partIds.set(index, id);
  state.open.add(index);
  return index;
}

function updateToolPart(
  state: LiveStreamState,
  toolCallId: string,
  update: (part: Part) => void,
): void {
  const index = state.toolIndex.get(toolCallId);
  if (index === undefined) {
    return;
  }
  const part = state.message.parts[index];
  if (part) {
    update(part);
  }
}

/**
 * Index of the tool part for `toolCallId`, creating it when the stream never
 * announced the call with a `tool-input-start`.
 *
 * Provider-executed tools (built-in web search and the like) and providers
 * that batch their tool payload arrive as a bare `tool-input-available`; before
 * this, `updateToolPart` found no index and the call silently vanished from the
 * stored answer and from every resume. The tool name is remembered so a later
 * output-only chunk can still materialize the part.
 */
function ensureToolPart(
  state: LiveStreamState,
  toolCallId: string,
  toolName?: string,
  providerExecuted?: boolean,
): number {
  if (toolName !== undefined) {
    state.toolNames.set(toolCallId, toolName);
  }
  const existing = state.toolIndex.get(toolCallId);
  if (existing !== undefined) {
    const part = state.message.parts[existing];
    if (part && "toolCallId" in part && providerExecuted !== undefined) {
      part.providerExecuted = providerExecuted;
    }
    return existing;
  }
  const name = toolName ?? state.toolNames.get(toolCallId);
  if (name === undefined) {
    // Without a name the part cannot be typed or replayed; nothing to create.
    return -1;
  }
  const index = state.message.parts.length;
  state.message.parts.push({
    type: `tool-${name}`,
    toolCallId,
    state: "input-streaming",
    ...(providerExecuted === undefined ? {} : { providerExecuted }),
  } as unknown as Part);
  state.toolIndex.set(toolCallId, index);
  return index;
}

/**
 * Writes each measured reasoning phase onto its reasoning part (`durationMs`),
 * in part order. Persisted this way the per-step Thought durations survive
 * reloads without a dedicated column; extra phases or parts stay unmatched
 * instead of shifting the alignment.
 */
function zipReasoningDurations(state: LiveStreamState): void {
  const durations = state.message.metadata?.reasoningDurations;
  if (!durations || durations.length === 0) {
    return;
  }
  // Reuses the one zipping implementation the reasoning timer ships with.
  state.message.parts = withReasoningDurations(state.message.parts, durations);
}

function closeToolInput(state: LiveStreamState, toolCallId: string): void {
  const index = state.toolIndex.get(toolCallId);
  if (index !== undefined) {
    state.open.delete(index);
  }
}

/** Persistable parts: framing data chunks never become message content. */
export function persistableParts(state: LiveStreamState): Part[] {
  return state.message.parts.filter(
    (part) =>
      part.type !== "step-start" &&
      !part.type.startsWith("data-"),
  ) as Part[];
}

/**
 * Chunks that rebuild the current answer state for a (re)connecting client.
 *
 * `start` carries the stable message id so the client replaces the placeholder
 * in place (`resumeStreamIsReplay`), then each part is replayed in order:
 * already-finished parts are closed, a part still streaming is left open so
 * the live deltas that follow continue it — the resumed answer reads as one
 * continuous message (`ABC` + `D` = `ABCD`), with no duplicated part or id.
 */
export function resumePrefixChunks(state: LiveStreamState): ChatChunk[] {
  const chunks: ChatChunk[] = [
    ...(state.announceTopic
      ? ([
          {
            type: "data-topic",
            data: {
              topicId: state.topicId ?? "",
              streamId: state.generationId,
            },
          },
        ] as ChatChunk[])
      : []),
    {
      type: "start",
      messageId: state.message.id,
      ...(Object.keys(state.message.metadata).length > 0
        ? { messageMetadata: state.message.metadata }
        : {}),
    },
  ];
  state.message.parts.forEach((part, index) => {
    chunks.push(...partChunks(state, part, index));
  });
  return chunks;
}

/**
 * Chunks that replay an already-finished message (terminal generation) so a
 * duplicate POST or a late subscriber sees the final answer without another
 * model call.
 */
export function finishedMessageChunks(input: {
  message: ChatUIMessage;
  metadata?: ChatMetadata;
  topicId: string | null;
  generationId: string;
  announceTopic?: boolean;
}): ChatChunk[] {
  const state = createLiveStreamState({
    generationId: input.generationId,
    userId: "",
    topicId: input.topicId,
    assistantMessageId: input.message.id,
    metadata: { ...input.message.metadata, ...input.metadata },
    announceTopic: input.announceTopic ?? true,
  });
  for (const part of input.message.parts) {
    state.message.parts.push(part);
  }
  const chunks = resumePrefixChunks(state);
  chunks.push({
    type: "finish",
    ...(Object.keys(state.message.metadata).length > 0
      ? { messageMetadata: state.message.metadata }
      : {}),
  });
  return chunks;
}

function partChunks(
  state: LiveStreamState,
  part: Part,
  index: number,
): ChatChunk[] {
  const open = state.open.has(index);
  switch (part.type) {
    case "text": {
      const id = state.partIds.get(index) ?? `resume-text-${index}`;
      return [
        { type: "text-start", id },
        ...(part.text.length > 0
          ? [{ type: "text-delta", id, delta: part.text } as ChatChunk]
          : []),
        ...(open ? [] : [{ type: "text-end", id } as ChatChunk]),
      ];
    }
    case "reasoning": {
      const id = part.id ?? state.partIds.get(index) ?? `resume-reasoning-${index}`;
      return [
        { type: "reasoning-start", id },
        ...(part.text.length > 0
          ? [{ type: "reasoning-delta", id, delta: part.text } as ChatChunk]
          : []),
        ...(open ? [] : [{ type: "reasoning-end", id } as ChatChunk]),
      ];
    }
    case "step-start": {
      return [{ type: "start-step" }];
    }
    case "file": {
      return [{ type: "file", url: part.url, mediaType: part.mediaType }];
    }
    case "source-document": {
      const source = part as unknown as {
        sourceId: string;
        mediaType: string;
        title: string;
        filename?: string;
      };
      return [
        {
          type: "source-document",
          sourceId: source.sourceId,
          mediaType: source.mediaType,
          title: source.title,
          ...(source.filename === undefined
            ? {}
            : { filename: source.filename }),
        },
      ];
    }
    default: {
      if (part.type.startsWith("tool-")) {
        return toolChunks(state, part, open);
      }
      if (part.type === "source-url") {
        const source = part as unknown as {
          sourceId: string;
          url: string;
          title?: string;
        };
        return [
          {
            type: "source-url",
            sourceId: source.sourceId,
            url: source.url,
            ...(source.title === undefined ? {} : { title: source.title }),
          },
        ];
      }
      return [];
    }
  }
}

function toolChunks(
  state: LiveStreamState,
  part: Part,
  open: boolean,
): ChatChunk[] {
  const toolCallId = toolCallIdOf(part);
  if (toolCallId === undefined) {
    return [];
  }
  const toolPart = part as {
    state?: string;
    toolName?: string;
    providerExecuted?: boolean;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  const toolName =
    toolPart.toolName ??
    state.toolNames.get(toolCallId) ??
    part.type.slice("tool-".length);
  const providerExecuted = toolPart.providerExecuted;
  const raw = state.toolRaw.get(toolCallId) ?? "";
  const chunks: ChatChunk[] = [
    {
      type: "tool-input-start",
      toolCallId,
      toolName,
      ...(providerExecuted === undefined ? {} : { providerExecuted }),
    },
  ];
  if (raw.length > 0) {
    chunks.push({ type: "tool-input-delta", toolCallId, inputTextDelta: raw });
  }
  if (open) {
    return chunks;
  }
  switch (toolPart.state) {
    case "input-available":
    case "output-available":
    case "output-error": {
      chunks.push({
        type: "tool-input-available",
        toolCallId,
        toolName,
        input: toolPart.input,
        ...(providerExecuted === undefined ? {} : { providerExecuted }),
      });
      break;
    }
    default: {
      break;
    }
  }
  if (toolPart.state === "output-available") {
    chunks.push({
      type: "tool-output-available",
      toolCallId,
      output: toolPart.output,
      ...(providerExecuted === undefined ? {} : { providerExecuted }),
    });
  } else if (toolPart.state === "output-error") {
    chunks.push({
      type: "tool-output-error",
      toolCallId,
      errorText: toolPart.errorText ?? "",
      ...(providerExecuted === undefined ? {} : { providerExecuted }),
    });
  }
  return chunks;
}
