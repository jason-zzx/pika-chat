import "server-only";

import { stepCountIs, tool, type Instructions, type ToolSet } from "ai";

import {
  fetchPageToolInputSchema,
  searchWebToolInputSchema,
  type FetchPageToolOutput,
  type SearchWebToolOutput,
} from "@/lib/schemas/search-provider";
import { ChainError, runChain } from "@/server/ai/search/chain";
import {
  createFetchAdapter,
  createSearchAdapter,
  isFetchCapable,
} from "@/server/ai/search/providers";
import type { SearchProviderCredential } from "@/server/services/search-provider.service";
import { logger } from "@/server/logger";

/**
 * Step budget for turns with the search tool: up to TOOL_TURN_STEP_LIMIT
 * steps, with the final allowed step forced to `toolChoice: "none"` so the
 * turn always ends with a text answer instead of dangling on tool results
 * (a model that spends every step searching otherwise never answers).
 */
export const TOOL_TURN_STEP_LIMIT = 5;

/**
 * Appended to the forced final step's instructions (R9 prevention): weak
 * models otherwise answer the tool-less step by emitting their native
 * `<tool_call>…` markup as plain text instead of answering.
 */
export const FORCED_STEP_DIRECTIVE =
  "You have finished researching. Now answer the user's question directly using the information you gathered. Do not call any tools and do not emit any tool-call markup.";

/**
 * Per-request source numbering (R14): every served searchWeb result and the
 * fetchPage page get a `num` from one counter shared across both tools, so
 * nums are unique within the turn in execution order, starting at 1. Error
 * outputs carry no nums.
 */
type SourceNumbering = { next: () => number };

export function createSourceNumbering(): SourceNumbering {
  let nextNum = 1;
  return {
    next: () => {
      const num = nextNum;
      nextNum += 1;
      return num;
    },
  };
}

function appendForcedStepDirective(
  instructions: Instructions | undefined,
): Instructions {
  if (instructions === undefined) {
    return FORCED_STEP_DIRECTIVE;
  }
  if (typeof instructions === "string") {
    return `${instructions}\n\n${FORCED_STEP_DIRECTIVE}`;
  }
  const directive = {
    role: "system" as const,
    content: FORCED_STEP_DIRECTIVE,
  };
  return Array.isArray(instructions)
    ? [...instructions, directive]
    : [instructions, directive];
}

/**
 * Step budget for turns with the search tool: up to TOOL_TURN_STEP_LIMIT
 * steps, with the final allowed step forced to answer — `toolChoice:
 * "none"`, no tool definitions (`activeTools: []`), and an explicit
 * answer-now instruction — so the turn always ends with a text answer
 * instead of dangling on tool results (R7) or leaking tool-call markup
 * as text (R9).
 */
export function toolTurnStepSettings() {
  return {
    stopWhen: stepCountIs(TOOL_TURN_STEP_LIMIT),
    prepareStep: ({
      stepNumber,
      instructions,
    }: {
      stepNumber: number;
      instructions?: Instructions;
    }) =>
      stepNumber === TOOL_TURN_STEP_LIMIT - 1
        ? {
            toolChoice: "none" as const,
            activeTools: [],
            instructions: appendForcedStepDirective(instructions),
          }
        : {},
  };
}

/**
 * Builds the searchWeb tool from the caller's already-resolved credentials
 * (loaded once per request by the chat route). Total chain failure is
 * returned as a normal tool output so the model can answer without search —
 * it is not thrown into the stream.
 */
export function createSearchWebTool(
  credentials: SearchProviderCredential[],
  options: { hasFetchPage?: boolean; numbering: SourceNumbering },
) {
  const { numbering } = options;
  return tool({
    description:
      "Search the web for current information. Use when the answer depends on recent events, facts, or sources you may not know. Returns titles, links, and content snippets." +
      (options.hasFetchPage
        ? " To read one specific page in depth, use the fetchPage tool with its URL."
        : ""),
    inputSchema: searchWebToolInputSchema,
    execute: async ({ query }): Promise<SearchWebToolOutput> => {
      const chain = credentials.map((credential) => ({
        provider: credential.provider,
        call: createSearchAdapter(credential),
      }));
      try {
        const { provider, value } = await runChain(chain, query);
        return {
          provider,
          query,
          results: value.map((result) => ({ ...result, num: numbering.next() })),
        };
      } catch (error) {
        if (error instanceof ChainError) {
          // Providers and counts only — never the query or keys.
          logger.warn(
            { attemptedProviders: error.attemptedProviders },
            "web search failed for all configured providers",
          );
          return {
            error: "search_failed",
            attemptedProviders: error.attemptedProviders,
          };
        }
        throw error;
      }
    },
  });
}

/**
 * Builds the fetchPage tool (R11): reads the full content of one specific
 * page, typically a URL from a prior searchWeb result. The chain walks only
 * fetch-capable providers (brave is excluded). Total failure returns a
 * normal `fetch_failed` tool output so the model can still answer.
 */
export function createFetchPageTool(
  credentials: SearchProviderCredential[],
  options: { numbering: SourceNumbering },
) {
  const { numbering } = options;
  return tool({
    description:
      "Fetch and read the full text content of a specific web page by URL. Use after searchWeb when you need to read one of its results in depth; searchWeb finds information, fetchPage reads one page.",
    inputSchema: fetchPageToolInputSchema,
    execute: async ({ url }): Promise<FetchPageToolOutput> => {
      const chain = credentials
        .filter((credential) => isFetchCapable(credential.provider))
        .flatMap((credential) => {
          const fetchPage = createFetchAdapter(credential);
          return fetchPage
            ? [{ provider: credential.provider, call: fetchPage }]
            : [];
        });
      try {
        const { provider, value } = await runChain(chain, url);
        return { provider, num: numbering.next(), ...value };
      } catch (error) {
        if (error instanceof ChainError) {
          // Providers and counts only — never the URL or keys.
          logger.warn(
            { attemptedProviders: error.attemptedProviders },
            "page fetch failed for all configured providers",
          );
          return {
            error: "fetch_failed",
            attemptedProviders: error.attemptedProviders,
          };
        }
        throw error;
      }
    },
  });
}

/**
 * Builds the tools record registered on tool-mode turns. `fetchPage` exists
 * only when at least one configured provider can fetch URLs — the model
 * cannot call what is not registered (R11). The return is typed as the
 * generic `ToolSet`: the conditional presence of `fetchPage` must not leak
 * into the streamText generic (a union tools record breaks TextStreamPart
 * variance against the transform/merge pipeline).
 */
export function buildSearchTools(
  credentials: SearchProviderCredential[],
): ToolSet {
  const hasFetchPage = credentials.some((credential) =>
    isFetchCapable(credential.provider),
  );
  // One counter shared by both tools keeps citation nums unique across all
  // tool calls of the turn (R14).
  const numbering = createSourceNumbering();
  const tools: ToolSet = {
    searchWeb: createSearchWebTool(credentials, { hasFetchPage, numbering }),
  };
  if (hasFetchPage) {
    tools.fetchPage = createFetchPageTool(credentials, { numbering });
  }
  return tools;
}
