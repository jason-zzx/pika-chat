import "server-only";

import { and, eq, lte } from "drizzle-orm";

import { newId } from "@/lib/id";
import { loadProviderEndpoint } from "@/server/ai/chat-model";
import { parseProviderFileReference } from "@/server/ai/provider-files";
import type { ProviderEndpoint } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/client";
import {
  providerFileDeleteRetries,
  type ProviderFileReference,
} from "@/server/db/schema";
import { logger } from "@/server/logger";

/**
 * Provider-side deletion linked to local attachment deletion.
 *
 * Anthropic's Files API has no expiry, so a locally deleted attachment leaves
 * an orphan on the provider unless we delete it too. Gemini files expire after
 * 48h on their own, so references with an `expiresAt` are skipped. Everything
 * here is best-effort: the local row is already gone by the time it runs, so no
 * failure may propagate, and the only durable outcome is a bounded retry queue
 * drained by the orphan sweep.
 *
 * Downloads are never attempted: every call is a DELETE for a file id we
 * recorded ourselves, so there is no key-collision risk with other consumers
 * of the same provider account.
 */

/** Anthropic's Files API protocol headers, matching the SDK upload path. */
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_FILES_BETA = "files-api-2025-04-14";

/** A hung provider must not stall the upload that triggered the sweep. */
const DELETE_TIMEOUT_MS = 10_000;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Retry backoff, indexed by the number of failures recorded on the entry. A
 * fresh entry waits 1h; the fourth failed retry waits 48h before the fifth and
 * final attempt. After five failures the entry is abandoned.
 */
const RETRY_BACKOFF_MS = [1, 4, 12, 24, 48].map((hours) => hours * HOUR_MS);

export const MAX_DELETE_ATTEMPTS = RETRY_BACKOFF_MS.length;

/** The minimum a caller must have loaded for deletion to be possible. */
export type ProviderReferencedFile = {
  id: string;
  providerReferences: Record<string, ProviderFileReference>;
};

export type ProviderDeleteOutcome =
  /** The provider no longer has the file (2xx or 404). Terminal. */
  | { kind: "resolved" }
  /**
   * Retrying cannot help: the config is gone, it no longer speaks Claude, or
   * it rejected our credentials. Terminal, logged and dropped.
   */
  | { kind: "abandoned"; status: number | null; reason: AbandonReason }
  /** Transient (429, 5xx, network). Belongs in the retry queue. */
  | { kind: "retry"; status: number | null };

export type AbandonReason = "configMissing" | "formatChanged" | "credentials";
function nextBackoffMs(attempts: number): number {
  const index = Math.min(attempts, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[index]!;
}

/** The Anthropic file id inside a stored reference, or `null` if malformed. */
function anthropicFileId(reference: ProviderFileReference): string | null {
  const id = reference.reference.anthropic;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * `DELETE {baseUrl}/files/{id}`. Mirrors `discovery.ts`: the stored base URL
 * already carries the version segment (`https://api.anthropic.com/v1`), so
 * only `/files` is appended. Returns the HTTP status, or `null` when the
 * request never completed (network failure or timeout).
 */
async function requestAnthropicDelete(
  endpoint: ProviderEndpoint,
  providerFileId: string,
): Promise<number | null> {
  const url = `${endpoint.baseUrl.replace(/\/+$/, "")}/files/${encodeURIComponent(providerFileId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-api-key": endpoint.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_FILES_BETA,
      },
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    });
  } catch {
    // Network error, DNS failure, timeout — always transient.
    return null;
  }
  // The body is irrelevant; drain it so the connection can be reused.
  await response.body?.cancel().catch(() => {});
  return response.status;
}

/**
 * One deletion attempt against the provider, classified. Never throws.
 *
 * 2xx and 404 both mean "the provider no longer has it". 401/403 mean the
 * credential is bad or revoked — retrying would only burn quota. Everything
 * else, including an unreachable endpoint, is retryable.
 */
export async function attemptDelete(
  providerConfigId: string,
  providerFileId: string,
): Promise<ProviderDeleteOutcome> {
  let endpoint: ProviderEndpoint | null;
  try {
    endpoint = await loadProviderEndpoint(providerConfigId);
  } catch (error) {
    // A rotated encryption secret makes the key undecryptable. Retrying
    // cannot recover it, so this is terminal, not transient.
    logger.warn(
      { err: error, providerConfigId, providerFileId },
      "provider file delete: config load failed",
    );
    return { kind: "abandoned", status: null, reason: "configMissing" };
  }
  if (!endpoint) {
    return { kind: "abandoned", status: null, reason: "configMissing" };
  }
  if (endpoint.apiFormat !== "claude") {
    // The config was switched to another format after the reference was
    // written; the file id no longer belongs to that endpoint.
    return { kind: "abandoned", status: null, reason: "formatChanged" };
  }

  const status = await requestAnthropicDelete(endpoint, providerFileId);
  if (status === null) {
    return { kind: "retry", status: null };
  }
  if (status === 404 || (status >= 200 && status < 300)) {
    return { kind: "resolved" };
  }
  if (status === 401 || status === 403) {
    return { kind: "abandoned", status, reason: "credentials" };
  }
  return { kind: "retry", status };
}

/**
 * Schedules a transient failure for a later attempt. Skips an entry that is
 * already queued for the same provider file so a repeated local delete (or a
 * concurrent sweep) cannot reset its backoff or duplicate the work. Never
 * throws: the local attachment is already deleted.
 */
export async function enqueueRetry(
  providerConfigId: string,
  providerFileId: string,
  lastStatus: number | null,
): Promise<void> {
  try {
    const db = getDb();
    const existing = await db
      .select({ id: providerFileDeleteRetries.id })
      .from(providerFileDeleteRetries)
      .where(
        and(
          eq(providerFileDeleteRetries.providerConfigId, providerConfigId),
          eq(providerFileDeleteRetries.providerFileId, providerFileId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return;
    }
    await db.insert(providerFileDeleteRetries).values({
      id: newId(),
      providerConfigId,
      providerFileId,
      attempts: 0,
      nextRetryAt: new Date(Date.now() + nextBackoffMs(0)),
      lastStatus,
    });
    logger.info(
      { providerConfigId, providerFileId, lastStatus },
      "provider file delete scheduled for retry",
    );
  } catch (error) {
    logger.warn(
      { err: error, providerConfigId, providerFileId },
      "failed to enqueue provider file delete retry",
    );
  }
}

/**
 * Deletes every provider-side file recorded on a locally deleted attachment.
 * Never throws — it runs after the local row is already gone, so a failure can
 * only be logged or queued.
 *
 * References with an `expiresAt` are skipped: Gemini files expire 48h after
 * upload, so deleting them is unnecessary traffic.
 */
export async function deleteProviderFileReferences(
  file: ProviderReferencedFile,
): Promise<void> {
  const references = file.providerReferences ?? {};
  for (const [configId, raw] of Object.entries(references)) {
    const record = parseProviderFileReference(raw);
    if (!record) {
      logger.warn(
        { fileId: file.id, providerConfigId: configId },
        "provider file delete: malformed reference record skipped",
      );
      continue;
    }
    if (record.expiresAt !== null) {
      continue;
    }
    const providerFileId = anthropicFileId(record);
    if (!providerFileId) {
      logger.warn(
        { fileId: file.id, providerConfigId: configId },
        "provider file delete: no anthropic file id in reference",
      );
      continue;
    }

    const outcome = await attemptDelete(configId, providerFileId);
    switch (outcome.kind) {
      case "resolved":
        logger.info(
          { fileId: file.id, providerConfigId: configId, providerFileId },
          "provider file deleted",
        );
        break;
      case "abandoned":
        logger.warn(
          {
            fileId: file.id,
            providerConfigId: configId,
            providerFileId,
            status: outcome.status,
            reason: outcome.reason,
          },
          "provider file delete abandoned",
        );
        break;
      case "retry":
        await enqueueRetry(configId, providerFileId, outcome.status);
        break;
    }
  }
}

/**
 * Drains due retry entries across every user. Provider files have no user
 * semantics, so the queue is global; the sweep that triggers this is scoped to
 * whoever uploaded. An empty queue costs one indexed query and zero provider
 * calls.
 */
export async function processDeleteRetries(): Promise<void> {
  let rows: Array<typeof providerFileDeleteRetries.$inferSelect>;
  try {
    rows = await getDb()
      .select()
      .from(providerFileDeleteRetries)
      .where(lte(providerFileDeleteRetries.nextRetryAt, new Date()));
  } catch (error) {
    logger.warn({ err: error }, "provider file delete retry scan failed");
    return;
  }
  for (const row of rows) {
    await processRetryRow(row);
  }
}

async function processRetryRow(
  row: typeof providerFileDeleteRetries.$inferSelect,
): Promise<void> {
  const db = getDb();
  const context = {
    providerConfigId: row.providerConfigId,
    providerFileId: row.providerFileId,
  };
  try {
    const outcome = await attemptDelete(row.providerConfigId, row.providerFileId);
    const attempts = row.attempts + 1;
    const terminal =
      outcome.kind !== "retry" || attempts >= MAX_DELETE_ATTEMPTS;

    if (terminal) {
      await db
        .delete(providerFileDeleteRetries)
        .where(eq(providerFileDeleteRetries.id, row.id));
      if (outcome.kind === "resolved") {
        logger.info({ ...context, attempts: row.attempts }, "provider file deleted on retry");
      } else if (outcome.kind === "abandoned") {
        logger.warn(
          { ...context, status: outcome.status, reason: outcome.reason },
          "provider file delete abandoned on retry",
        );
      } else {
        logger.warn(
          { ...context, attempts, lastStatus: outcome.status },
          "provider file delete giving up after max attempts",
        );
      }
      return;
    }

    await db
      .update(providerFileDeleteRetries)
      .set({
        attempts,
        lastStatus: outcome.status,
        nextRetryAt: new Date(Date.now() + nextBackoffMs(attempts)),
      })
      .where(eq(providerFileDeleteRetries.id, row.id));
  } catch (error) {
    logger.warn({ err: error, ...context }, "provider file delete retry threw");
  }
}
