import "server-only";

import { fileIdFromUrl } from "@/lib/files/media-types";
import type { ChatUIMessage } from "@/lib/schemas/chat";
import { errorsTranslatorFor } from "@/i18n/server-translator";
import {
  runGenerationTurn,
  type TurnFinalizeInput,
  type TurnHooks,
} from "@/server/ai/generation-turn";
import {
  applyChunk,
  createLiveStreamState,
  finishedMessageChunks,
  persistableParts,
  resumePrefixChunks,
  type ChatChunk,
  type LiveStreamState,
} from "@/server/ai/generation-stream";
import {
  addLiveGeneration,
  closeAllSubscribers,
  createLiveGeneration,
  discardLiveGenerationsForTopic,
  getLiveGeneration,
  listLiveGenerations,
  publishChunk,
  removeLiveGeneration,
  subscribeToLiveGeneration,
  type LiveGeneration,
} from "@/server/ai/generation-registry";
import { deleteFile } from "@/server/files/file.service";
import { stripMarkupFromTextParts } from "@/server/ai/search/markup-sanitizer";
import { messageVersionMetadata } from "@/server/services/message.service";
import { logger } from "@/server/logger";
import { AppError } from "@/server/errors";
import {
  checkpointGeneration,
  claimGeneration,
  currentGenerationStatus,
  finalizeGeneration,
  generationActor,
  listQueuedGenerationIds,
  markGenerationStopping,
  purgeTerminalGenerations,
  recoverInterruptedGenerations,
  type FinalizeGenerationInput,
  type FinalizeResult,
  type GenerationRow,
} from "@/server/services/generation.service";

/**
 * Single-process executor for admitted generations (chat task §5).
 *
 * Ownership model: the HTTP request that admitted a turn returns a *subscriber*
 * stream, never the producer. The producer lives here, wakes immediately on
 * admission, and keeps running when every browser is gone. Exactly one process
 * runs a turn — the database claim makes that true even for duplicate wake-ups
 * — and a process crash leaves the row `running`, which the next boot closes
 * as `interrupted` instead of re-running model/tool work.
 */

/** How often the current answer state is persisted for crash retention. */
export const CHECKPOINT_INTERVAL_MS = 10_000;
/** Backstop sweep for queued rows (admission wakes turns immediately). */
const SWEEP_INTERVAL_MS = 60_000;
/** Receipt cleanup cadence (terminal rows older than their window). */
const PURGE_EVERY_SWEEPS = 60;
/** Retry cadence while the boot recovery cannot run (DB not ready yet). */
const RECOVERY_RETRY_MS = 5_000;
/** How long a normal shutdown waits for partial answers to be saved. */
const SHUTDOWN_TIMEOUT_MS = 10_000;
/**
 * Backoff of the terminal-write retry: a failed final transaction is retried in
 * the same process (the model is never called again, only the save is repeated)
 * so a transient write error cannot leave the row `running` and the topic busy.
 * The cap keeps a shutdown waiting at most one extra step.
 */
const TERMINAL_RETRY_BASE_MS = 200;
const TERMINAL_RETRY_MAX_MS = 2_000;
/** Log every Nth failed terminal retry instead of every attempt. */
const TERMINAL_RETRY_LOG_EVERY = 10;

type RunnerState = {
  /** Shared boot promise: recovery → sweep, resolved only when recovery ran. */
  ready: Promise<void> | null;
  sweepTimer: ReturnType<typeof setInterval> | null;
  sweepCount: number;
  /** Set by `stopGenerationRunner`: no new claim, no new wake-up. */
  shuttingDown: boolean;
  /**
   * The one shutdown in progress. Repeated calls return this same promise, so a
   * second caller (SIGTERM after SIGINT, a test, the framework) waits for the
   * real settle instead of returning before the saves are committed.
   */
  shutdown: Promise<void> | null;
  /** Per-task claim promises (duplicate wake-ups share one claim). */
  starting: Map<string, Promise<LiveGeneration | null>>;
  /**
   * Work that outlives its generation row but must still be cancelled with the
   * topic (title naming today; search/fetch cleanup in the next phase). Keyed
   * by topic id, aborted by the delete paths.
   */
  postTurn: Map<string, Set<AbortController>>;
};

/**
 * Process-wide runner state. It lives on `globalThis` because Next.js may
 * re-evaluate this module (dev HMR, route bundling): a module-local flag would
 * let a second instance re-run boot recovery and start a second sweep.
 */
const RUNNER_KEY = Symbol.for("pika.generation-runner.state");

function runnerState(): RunnerState {
  const holder = globalThis as unknown as Record<
    symbol,
    RunnerState | undefined
  >;
  const existing = holder[RUNNER_KEY];
  if (existing) {
    return existing;
  }
  const created: RunnerState = {
    ready: null,
    sweepTimer: null,
    sweepCount: 0,
    shuttingDown: false,
    shutdown: null,
    starting: new Map(),
    postTurn: new Map(),
  };
  holder[RUNNER_KEY] = created;
  return created;
}

/**
 * Boots the executor: close what a previous process left behind, then start
 * claiming queued turns. Called from `instrumentation.register`; builds and
 * tests never schedule work.
 *
 * Concurrent callers (multiple instrumentation invocations, HMR) share one
 * boot promise, and the promise resolves only after recovery succeeded — new
 * turns are never claimed while leftover `running`/`stopping` rows from the
 * previous process are still open (chat task §5).
 */
export function startGenerationRunner(): Promise<void> {
  const state = runnerState();
  if (state.ready) {
    return state.ready;
  }
  if (state.shutdown) {
    // A process that is shutting down never boots the executor again: a second
    // boot would re-claim exactly the work the shutdown stopped.
    return state.shutdown;
  }
  state.shuttingDown = false;
  const ready = bootRunner(state);
  state.ready = ready;
  return ready;
}

async function bootRunner(state: RunnerState): Promise<void> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const recovered = await recoverInterruptedGenerations();
      if (recovered.interrupted > 0 || recovered.stopped > 0) {
        logger.warn(recovered, "generation runner recovered leftover turns");
      }
      break;
    } catch (error) {
      // Recovery is a precondition for accepting turns, so a failure must not
      // fall through to sweeping: retry until it succeeds (the process cannot
      // admit turns without the database anyway).
      logger.error(
        { errorName: error instanceof Error ? error.name : undefined, attempt },
        "generation runner recovery failed; not accepting turns yet",
      );
      await delay(RECOVERY_RETRY_MS);
      if (state.shuttingDown) {
        return;
      }
    }
  }
  if (state.shuttingDown) {
    return;
  }
  await sweepQueued(state);
  if (state.shuttingDown) {
    return;
  }
  state.sweepTimer = setInterval(() => {
    void sweepQueued(state);
  }, SWEEP_INTERVAL_MS);
  // Never keep the process alive just for the sweep timer.
  state.sweepTimer.unref?.();
  logger.info("generation runner started");
}

async function sweepQueued(state: RunnerState): Promise<void> {
  if (state.shuttingDown) {
    return;
  }
  state.sweepCount += 1;
  try {
    const ids = await listQueuedGenerationIds();
    for (const id of ids) {
      void ensureGenerationRunning(id);
    }
    if (state.sweepCount % PURGE_EVERY_SWEEPS === 0) {
      const purged = await purgeTerminalGenerations();
      if (purged > 0) {
        logger.info({ purged }, "expired generation receipts purged");
      }
    }
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : undefined }, "generation sweep failed");
  }
}

/**
 * Explicit runner stop, used for test cleanup and direct stop verification:
 * stop accepting work, abort live turns, and await their partial-answer saves.
 * Production process exits do not invoke this API; they rely on persisted
 * checkpoints and next-boot recovery (R9) to close leftover rows.
 *
 * Repeated calls await the same shutdown: a caller that asks again must not
 * observe "done" while the first save is still running.
 */
export function stopGenerationRunner(): Promise<void> {
  const state = runnerState();
  state.shutdown ??= runShutdown(state);
  return state.shutdown;
}

async function runShutdown(state: RunnerState): Promise<void> {
  state.shuttingDown = true;
  state.ready = null;
  if (state.sweepTimer) {
    clearInterval(state.sweepTimer);
    state.sweepTimer = null;
  }
  abortAllPostTurnTasks(state);

  // One deadline for the whole shutdown, shared by every stage below.
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  const remaining = (): number => Math.max(0, deadline - Date.now());

  for (;;) {
    // A claim that is still in flight is not registered as live yet, but it
    // already won the row (`queued` → `running`): the next process will not
    // pick it up, so this one has to wait for it, abort what it produced and
    // save that. Passing over it would lose an already-claimed turn.
    const claims = [...state.starting.values()];
    const live = listLiveGenerations();
    if (claims.length === 0 && live.length === 0) {
      return;
    }
    // Do not put active turns behind a blocked claim. Abort/save them now,
    // while also waiting for claims to hand over their newly acquired entries.
    for (const entry of live) {
      entry.status = "stopping";
      entry.controller.abort();
    }
    await settleWithin([...claims, ...live.map((entry) => entry.settled)], remaining());
    if (remaining() === 0) {
      logger.warn(
        { pending: listLiveGenerations().length, pendingClaims: state.starting.size },
        "generation shutdown timed out before every partial answer was saved",
      );
      return;
    }
  }
}

/** Resolves when every promise settled, or when `ms` elapsed (0 = at once). */
async function settleWithin(
  promises: Promise<unknown>[],
  ms: number,
): Promise<void> {
  await Promise.race([
    Promise.allSettled(promises).then(() => undefined),
    delay(ms),
  ]);
}

/** Test hook: drop runner state so a test can boot it again from scratch. */
export function resetGenerationRunnerForTests(): void {
  const state = runnerState();
  if (state.sweepTimer) {
    clearInterval(state.sweepTimer);
    state.sweepTimer = null;
  }
  abortAllPostTurnTasks(state);
  state.ready = null;
  state.sweepCount = 0;
  state.shuttingDown = false;
  state.shutdown = null;
  state.starting.clear();
}

/**
 * Ensures a generation is running in this process and returns its live entry.
 * Idempotent: concurrent callers share one claim, and a row another caller
 * already claimed returns null (it is already being executed here).
 *
 * Waits for boot recovery first when the executor is starting up, and returns
 * null while the process is shutting down — the task stays queued for the next
 * process instead of being claimed by a process that is about to exit.
 */
export async function ensureGenerationRunning(
  id: string,
): Promise<LiveGeneration | null> {
  const state = runnerState();
  if (state.ready) {
    await state.ready;
  }
  if (state.shuttingDown) {
    return null;
  }
  const existing = state.starting.get(id);
  if (existing) {
    return existing;
  }
  const promise = claimAndStart(state, id).finally(() => {
    state.starting.delete(id);
  });
  state.starting.set(id, promise);
  return promise;
}

async function claimAndStart(
  state: RunnerState,
  id: string,
): Promise<LiveGeneration | null> {
  const live = getLiveGeneration(id);
  if (live) {
    return live;
  }
  if (state.shuttingDown) {
    return null;
  }
  const row = await claimGeneration(id);
  if (!row) {
    return null;
  }
  const entry = await createLiveEntry(row);
  addLiveGeneration(entry);
  // A stop (or shutdown) can commit between our claim statement and this
  // continuation. Claiming only wins from `queued`, so re-read the durable
  // status now that the entry is registered: a concurrent stop finds the entry
  // and aborts it too, but a stop that already completed must not be missed
  // and then reach the model.
  const status = await currentGenerationStatus(row.id);
  if (status !== "running" || state.shuttingDown) {
    entry.status = "stopping";
    entry.controller.abort();
  }
  void executeTurn(row, entry);
  return entry;
}

async function createLiveEntry(row: GenerationRow): Promise<LiveGeneration> {
  // Group/version identity of the placeholder row rides in the live metadata:
  // the client replaces the seeded message in place on resume, and the message
  // list is keyed by `groupId`, so dropping it would move/remount the answer and
  // hide the version switcher (chat task §6).
  const version =
    row.topicId !== null && row.assistantMessageId !== null
      ? await messageVersionMetadata(row.topicId, row.assistantMessageId)
      : null;
  return createLiveGeneration({
    state: createLiveStreamState({
      generationId: row.id,
      userId: row.userId,
      topicId: row.topicId,
      assistantMessageId: row.assistantMessageId ?? "",
      announceTopic: row.kind === "send",
      metadata: {
        providerConfigId: row.input?.providerConfigId,
        modelId: row.input?.modelId,
        createdAt: row.createdAt.toISOString(),
        ...(version ?? {}),
      },
    }),
  });
}

/**
 * Content a checkpoint persists: the parts plus the usage/reasoning feedback
 * the answer has already collected (a crash must not keep the text but lose
 * the truncation/thinking hints).
 */
export function checkpointContentOf(state: LiveStreamState, toolMode = false): {
  parts: ChatUIMessage["parts"];
  providerConfigId?: string;
  modelId?: string;
  reasoningMs?: number;
  totalTokens?: number;
  finishReason?: string;
} {
  return {
    parts: toolMode
      ? stripMarkupFromTextParts(persistableParts(state))
      : persistableParts(state),
    ...persistedMetadataOf(state),
  };
}

/**
 * Metadata the durable row must carry: the model identity plus the
 * usage/reasoning feedback the answer collected. Read from the live state's
 * metadata, which the `finish` chunk already merges — checkpoints and the
 * terminal write therefore persist the same facts from the same source.
 */
export function persistedMetadataOf(state: LiveStreamState): {
  providerConfigId?: string;
  modelId?: string;
  reasoningMs?: number;
  totalTokens?: number;
  finishReason?: string;
} {
  const metadata = state.message.metadata;
  return {
    ...(metadata?.providerConfigId === undefined
      ? {}
      : { providerConfigId: metadata.providerConfigId }),
    ...(metadata?.modelId === undefined ? {} : { modelId: metadata.modelId }),
    ...(metadata?.reasoningMs === undefined
      ? {}
      : { reasoningMs: metadata.reasoningMs }),
    ...(metadata?.totalTokens === undefined
      ? {}
      : { totalTokens: metadata.totalTokens }),
    ...(metadata?.finishReason === undefined
      ? {}
      : { finishReason: metadata.finishReason }),
  };
}

/** Chunks that announce the end of a turn (only published after the save). */
function isTerminalChunk(chunk: ChatChunk): boolean {
  return chunk.type === "finish" || chunk.type === "abort" || chunk.type === "error";
}

async function executeTurn(
  row: GenerationRow,
  entry: LiveGeneration,
): Promise<void> {
  let finalized = false;
  let checkpointTimer: ReturnType<typeof setInterval> | null = null;
  let checkpointInFlight: Promise<unknown> | null = null;
  const t = await errorsTranslatorFor(row.input?.locale);

  const writeCheckpoint = (): void => {
    if (
      entry.discarded ||
      !entry.state.dirty ||
      checkpointInFlight !== null
    ) {
      return;
    }
    if (row.topicId === null || row.assistantMessageId === null) {
      return;
    }
    entry.state.dirty = false;
    checkpointInFlight = checkpointGeneration({
      topicId: row.topicId,
      messageId: row.assistantMessageId,
      ...checkpointContentOf(entry.state, row.input?.searchMode === "tool"),
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        // A failed checkpoint must never cancel the model call: the next one
        // (or the final write) still runs.
        logger.warn(
          { errorName: error instanceof Error ? error.name : undefined, generationId: row.id },
          "generation checkpoint write failed",
        );
      })
      .finally(() => {
        checkpointInFlight = null;
      });
  };

  const finish = async (
    final: TurnFinalizeInput,
  ): Promise<void> => {
    if (finalized) {
      return;
    }
    finalized = true;
    if (checkpointTimer) {
      clearInterval(checkpointTimer);
      checkpointTimer = null;
    }
    // The terminal write must win over an in-flight checkpoint: stop the timer,
    // let the pending write settle, then commit the final state.
    if (checkpointInFlight) {
      await checkpointInFlight;
    }

    // Single assembly path (chat task §3/§7): the answer is whatever the
    // `applyChunk` reducer accumulated. A turn may override it only when the
    // chunk protocol cannot carry what it needs (the image path's filename).
    const parts = final.parts ?? checkpointContentOf(
      entry.state, row.input?.searchMode === "tool",
    ).parts;
    const persisted = persistedMetadataOf(entry.state);
    const hasTarget = row.topicId !== null && row.assistantMessageId !== null;
    // The terminal payload is built once: a failed write is retried with
    // exactly this content (the turn is over; the live state must not keep
    // changing underneath it).
    const result = await persistTerminal(
      {
        id: row.id,
        topicId: row.topicId,
        assistantMessageId: row.assistantMessageId,
        status: final.outcome,
        errorMessage: final.errorMessage,
        discardPartsOnStop: final.generatedFileUrls !== undefined,
        message:
          hasTarget && !entry.discarded
            ? {
                topicId: row.topicId!,
                messageId: row.assistantMessageId!,
                parts,
                outcome: final.outcome,
                errorMessage: final.errorMessage,
                ...persisted,
              }
            : null,
      },
      row,
    );

    // Whether the answer is kept decides the fate of the files this turn
    // uploaded. Only an authoritative decision that the answer was NOT stored
    // (deleted target, a task another writer closed, a stopped image batch)
    // reclaims them: an undecided save (retried, or given up on shutdown) must
    // leave the images alone, because the content that references them may
    // still be committed — by the retry, or by the next boot from the last
    // checkpoint. A `completed` row this call did not write is our own lost
    // acknowledgement, so those files stay as well.
    const answerKept =
      result !== null &&
      result.status === "completed" &&
      !result.targetDeleted &&
      (result.messageStored || !result.settled);
    if (result !== null && !answerKept) {
      await cleanupGeneratedFiles(final.generatedFileUrls, row);
    }

    // The client only learns the turn ended once its content is committed
    // (chat task §3/§5): a turn whose save failed must not look finished.
    if (!entry.discarded) {
      if (result?.status && !result.targetDeleted) {
        // Also covers a committed write whose acknowledgement was lost. Every
        // durable outcome needs its own terminal signal, not just completed:
        // silently closing a failed/stopped stream looks like success to SDK
        // subscribers. The transaction's decision outranks a stale finish.
        publishChunk(entry, result.status === "stopped"
          ? { type: "abort" }
          : result.status === "completed"
            ? entry.pendingTerminal ?? { type: "finish" }
            : entry.pendingTerminal?.type === "error"
              ? entry.pendingTerminal
              : { type: "error", errorText: final.errorMessage ?? t("generic") });
      } else if (result === null) {
        publishChunk(entry, {
          type: "error",
          errorText: final.errorMessage ?? t("generic"),
        });
      }
    }
    closeAllSubscribers(entry);
    removeLiveGeneration(row.id);
    entry.markSettled();

    if (result?.settled && result.messageStored && result.status === "completed") {
      // Title generation is server-side and best-effort (chat task §7): it
      // must not block or fail the reply, must work with no browser open, and
      // the service refuses to overwrite a title the user already set. It is
      // tracked as a post-turn task so deleting the topic cancels it.
      void generateTitleAfterTurn(row);
    }
  };

  try {
    // A stop that landed between the claim and here must not call the model at
    // all: close the turn from its (empty) current state.
    if (entry.controller.signal.aborted) {
      await finish({ outcome: "stopped", errorMessage: null });
      return;
    }

    checkpointTimer = setInterval(writeCheckpoint, CHECKPOINT_INTERVAL_MS);
    checkpointTimer.unref?.();

    const hooks: TurnHooks = {
      signal: entry.controller.signal,
      onChunk: (chunk) => {
        if (entry.discarded) {
          // Target deleted: drop late output instead of filling memory.
          return;
        }
        applyChunk(entry.state, chunk);
        // SDK metadata chunks REPLACE the client metadata. The reducer merges
        // stable group/version identity, so publish that complete object too,
        // not the provider's partial finish/reasoning metadata.
        if (
          chunk.type === "start" ||
          chunk.type === "message-metadata" ||
          chunk.type === "finish"
        ) {
          chunk = { ...chunk, messageMetadata: { ...entry.state.message.metadata } };
        }
        if (isTerminalChunk(chunk)) {
          // Held until the terminal save commits (see `finish`).
          // An error terminates the SDK reader too. Hold it until persistence,
          // and do not replace it with a later finish chunk from the provider.
          if (entry.pendingTerminal?.type !== "error") {
            entry.pendingTerminal = chunk;
          }
          return;
        }
        publishChunk(entry, chunk);
      },
      finalize: (final) => finish(final),
      t,
    };
    await runGenerationTurn(row, hooks);
    // A turn that never reported a result (should not happen) still has to
    // close: treat the current state as the outcome.
    await finish({ outcome: "failed", errorMessage: null });
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : undefined, generationId: row.id },
      "generation turn failed",
    );
    await finish({
      outcome: entry.controller.signal.aborted ? "stopped" : "failed",
      // Non-stream errors include storage/DB exceptions whose message can
      // contain credentials or query parameters. Only typed catalog errors
      // are safe here; provider details are scrubbed inside the turn tracker.
      errorMessage: entry.controller.signal.aborted
        ? null
        : error instanceof AppError ? t(error.messageKey, error.params) : t("generic"),
    });
  }
}

/**
 * Commits the terminal state, retrying a failed write in the same process.
 *
 * A terminal transaction that throws used to end the turn anyway: the live
 * entry (and with it the only copy of the answer) was released while the row
 * stayed `running`, so the topic refused new turns until someone stopped it or
 * the process restarted. The model work is already finished, so the missing
 * piece is only the write: keep the final content and the generated-file
 * references alive and repeat the same transaction.
 *
 * The retry re-runs `finalizeGeneration`, which re-reads the task row and the
 * target under its own locks — so a stop, a delete or another writer that
 * landed in between still decides the outcome, and the answer is never written
 * over a terminal state. Nothing here calls the model again.
 *
 * Deliberately small: a fixed backoff, no queue, no scheduler, no persistence
 * of its own. A shutdown stops retrying (the next boot closes the row as
 * interrupted from the last checkpoint, R9), and the capped delay keeps a
 * shutdown waiting for at most one extra step.
 *
 * Returns `null` when the write was abandoned (only during shutdown), so the
 * caller does not publish a terminal chunk it cannot back with stored content.
 */
async function persistTerminal(
  input: FinalizeGenerationInput,
  row: GenerationRow,
): Promise<FinalizeResult | null> {
  const state = runnerState();
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await finalizeGeneration(input);
      if (attempt > 1) {
        logger.info(
          { generationId: row.id, attempt },
          "generation terminal write recovered",
        );
      }
      return result;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : undefined;
      if (attempt === 1) {
        logger.error(
          { errorName, generationId: row.id },
          "generation terminal write failed; retrying in this process",
        );
      } else if (attempt % TERMINAL_RETRY_LOG_EVERY === 0) {
        logger.warn(
          { errorName, generationId: row.id, attempt },
          "generation terminal write still failing",
        );
      }
      if (state.shuttingDown) {
        // The process is leaving: stop retrying and let boot recovery close the
        // row as interrupted instead of holding the shutdown window open.
        logger.warn(
          { errorName, generationId: row.id, attempt },
          "generation terminal write abandoned on shutdown",
        );
        return null;
      }
      await delay(
        Math.min(
          TERMINAL_RETRY_MAX_MS,
          TERMINAL_RETRY_BASE_MS * 2 ** (attempt - 1),
        ),
      );
    }
  }
}

/**
 * Runs a best-effort task that continues after its generation row is closed,
 * under the topic's lifecycle: deleting the topic (or shutting down) aborts the
 * signal, so a later phase can hand it to title/search services that accept
 * one. Deliberately minimal — no scheduler, no retries, no persistence.
 */
export function runPostTurnTask(
  topicId: string,
  run: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const state = runnerState();
  const controller = new AbortController();
  let tasks = state.postTurn.get(topicId);
  if (!tasks) {
    tasks = new Set();
    state.postTurn.set(topicId, tasks);
  }
  const registered = tasks;
  registered.add(controller);
  return run(controller.signal).finally(() => {
    registered.delete(controller);
    if (registered.size === 0 && state.postTurn.get(topicId) === registered) {
      state.postTurn.delete(topicId);
    }
  });
}

/** Cancels every post-turn task of a topic (called by the delete paths). */
export function abortPostTurnTasks(topicId: string): void {  const state = runnerState();
  const tasks = state.postTurn.get(topicId);
  if (!tasks) {
    return;
  }
  for (const controller of tasks) {
    controller.abort();
  }
  state.postTurn.delete(topicId);
}

function abortAllPostTurnTasks(state: RunnerState): void {
  for (const tasks of state.postTurn.values()) {
    for (const controller of tasks) {
      controller.abort();
    }
  }
  state.postTurn.clear();
}

async function generateTitleAfterTurn(row: GenerationRow): Promise<void> {
  const input = row.input;
  const topicId = row.topicId;
  if (!input?.titleCandidate || topicId === null) {
    return;
  }
  await runPostTurnTask(topicId, async (signal) => {
    try {
      const { titleTopicFromFirstMessage } = await import(
        "@/server/services/title.service"
      );
      // The signal is the topic's lifecycle: deleting the topic (or shutting
      // down) aborts the in-flight title request instead of letting it finish
      // against a conversation that no longer exists.
      await titleTopicFromFirstMessage(
        {
          topicId,
          providerConfigId: input.providerConfigId,
          modelId: input.modelId,
          signal,
        },
        generationActor(row),
      );
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : undefined, generationId: row.id },
        "server-side topic title generation failed",
      );
    }
  }).catch(() => undefined);
}

async function cleanupGeneratedFiles(
  urls: string[] | undefined,
  row: GenerationRow,
): Promise<void> {
  for (const url of urls ?? []) {
    const fileId = fileIdFromUrl(url);
    if (!fileId) {
      continue;
    }
    try {
      await deleteFile(fileId, generationActor(row));
    } catch (error) {
      // Best-effort, like the image batch cleanup: the orphan sweep reclaims
      // whatever is left.
      logger.warn(
        { errorName: error instanceof Error ? error.name : undefined, fileId, generationId: row.id },
        "generated image cleanup failed",
      );
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

// --- HTTP-facing helpers ---------------------------------------------------

/**
 * Subscribes one client to a live generation. The caller has already
 * authorized the row, so this only handles the state handoff: the current
 * answer is captured synchronously, then live chunks continue from exactly
 * that point (chat task §6 — no lost or duplicated output at the handoff).
 */
export function subscribeToGeneration(
  entry: LiveGeneration,
): ReadableStream<ChatChunk> {
  const prefix = resumePrefixChunks(entry.state);
  let detach: (() => void) | null = null;
  return new ReadableStream<ChatChunk>({
    start(c) {
      detach = subscribeOnRegistry(entry, prefix, c);
    },
    cancel() {
      // A browser going away only ends its subscription: the producer keeps
      // running (chat task R2).
      detach?.();
      detach = null;
    },
  });
}

function subscribeOnRegistry(
  entry: LiveGeneration,
  prefix: ChatChunk[],
  controller: ReadableStreamDefaultController<ChatChunk>,
): () => void {
  return subscribeToLiveGeneration(entry, prefix, {
    // The stream uses the default high-water mark of one. desiredSize rises
    // again as downstream drains, unlike a lifetime chunk counter.
    pendingChunks: () => Math.max(0, 1 - (controller.desiredSize ?? 0)),
    push: (chunk) => {
      try {
        controller.enqueue(chunk);
      } catch {
        // Closed by the consumer; nothing to do.
      }
    },
    close: () => {
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
  });
}

/**
 * Replays the finished answer of a generation that is no longer live, so a
 * duplicate POST (confirmation lost) or a late subscriber sees the result
 * without another model call.
 */
export function finishedGenerationChunks(
  row: GenerationRow,
  message: ChatUIMessage | null,
): ChatChunk[] {
  const base: ChatChunk[] = [
    {
      type: "start",
      messageId: row.assistantMessageId ?? message?.id ?? row.id,
    },
  ];
  if (!message) {
    return base;
  }
  return [
    ...finishedMessageChunks({
      message,
      topicId: row.topicId,
      generationId: row.id,
      announceTopic: row.kind === "send",
    }),
  ];
}

/**
 * Drops every live turn of a deleted topic/assistant (chat task §8): the
 * content is cleared, subscribers are closed and the producer is aborted so no
 * late chunk can reach a client that is still attached. The durable
 * `target_deleted` marking already happened inside the delete transaction.
 */
export function discardGenerationsForTopic(topicId: string): void {
  discardLiveGenerationsForTopic(topicId);
  abortPostTurnTasks(topicId);
}

/**
 * Stop request: queued turns never reach the model; running turns are aborted
 * and finish from their partial content. Idempotent for terminal rows.
 */
export async function stopGenerationById(
  id: string,
  actor: Parameters<typeof markGenerationStopping>[1],
): Promise<void> {
  const row = await markGenerationStopping(id, actor);
  if (row.status !== "stopping") {
    // Already terminal: nothing to cancel, nothing to write.
    return;
  }
  const state = runnerState();
  const live = getLiveGeneration(id);
  if (live) {
    live.status = "stopping";
    live.controller.abort();
    return;
  }
  // Not live here yet: a claim may be in flight. Wait for it, then abort the
  // entry it produced — otherwise the freshly claimed turn keeps calling the
  // provider even though the user already stopped it.
  const inFlight = state.starting.get(id);
  if (inFlight) {
    await inFlight;
    const acquired = getLiveGeneration(id);
    if (acquired) {
      acquired.status = "stopping";
      acquired.controller.abort();
      return;
    }
  }
  // Never started (queued) or owned by a process that is gone: close the row
  // and its placeholder now so the topic cannot linger as "generating".
  await finalizeGeneration({
    id,
    topicId: row.topicId,
    assistantMessageId: row.assistantMessageId,
    status: "stopped",
    errorMessage: null,
    message:
      row.topicId !== null && row.assistantMessageId !== null
        ? {
            topicId: row.topicId,
            messageId: row.assistantMessageId,
            outcome: "stopped",
            errorMessage: null,
          }
        : null,
  });
}
