import { z } from "zod";

export const SEARCH_PROVIDERS = ["tavily", "exa", "firecrawl", "brave"] as const;

export const searchProviderSchema = z.enum(SEARCH_PROVIDERS);
export type SearchProvider = z.infer<typeof searchProviderSchema>;

export const searchModeSchema = z.enum(["off", "builtin", "tool"]);
export type SearchMode = z.infer<typeof searchModeSchema>;

/**
 * PUT /api/search-providers/:provider body. Create requires `apiKey`; on
 * update an omitted `apiKey` keeps the stored key. `baseUrl` is nullable so a
 * client can clear a custom override back to the provider default.
 */
export const upsertSearchProviderSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url().nullable().optional(),
});
export type UpsertSearchProviderInput = z.infer<typeof upsertSearchProviderSchema>;

export const reorderSearchProvidersSchema = z.object({
  providers: z.array(searchProviderSchema),
});
export type ReorderSearchProvidersInput = z.infer<
  typeof reorderSearchProvidersSchema
>;

/** Response DTO — never carries the key itself, only its last four. */
export const searchProviderSettingSchema = z.object({
  provider: searchProviderSchema,
  baseUrl: z.string().nullable(),
  apiKeyLastFour: z.string(),
  position: z.number().int(),
  updatedAt: z.string(),
});
export type SearchProviderSetting = z.infer<typeof searchProviderSettingSchema>;

export const searchProviderSettingsResponseSchema = z.object({
  providers: z.array(searchProviderSettingSchema),
});
export type SearchProviderSettingsResponse = z.infer<
  typeof searchProviderSettingsResponseSchema
>;

// --- searchWeb tool contract (shared by the tool definition, the stored
// message part schema, and the frontend renderer) ---

export const searchWebResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  /** Per-turn citation number (R14), stamped by the tool at execution time
   * from a request-scoped counter shared with fetchPage. Optional so tool
   * outputs persisted before R14 still parse — they simply have no
   * resolvable citations. */
  num: z.number().int().positive().optional(),
  /** Published date as the provider reports it (exa: ISO datetime; tavily:
   * date string, news topic only; firecrawl/brave have no date field and
   * simply omit). Optional so persisted outputs predate the passthrough
   * still parse. */
  publishedDate: z.string().optional(),
});
export type SearchWebResult = z.infer<typeof searchWebResultSchema>;

export const searchWebToolInputSchema = z.object({
  query: z.string().min(1),
});
export type SearchWebToolInput = z.infer<typeof searchWebToolInputSchema>;

/**
 * Tool output: either the serving provider plus results, or a graceful
 * failure the model can react to (returned as a normal tool output, not a
 * thrown error).
 */
export const searchWebToolOutputSchema = z.union([
  z.object({
    provider: searchProviderSchema,
    query: z.string(),
    results: z.array(searchWebResultSchema),
  }),
  z.object({
    error: z.literal("search_failed"),
    attemptedProviders: z.array(searchProviderSchema),
  }),
]);
export type SearchWebToolOutput = z.infer<typeof searchWebToolOutputSchema>;

// --- fetchPage tool contract (R11/R12): reads the full content of one
// specific page, typically a URL from a prior searchWeb result. ---

/** Character cap for fetched page content fed back to the model. */
export const FETCH_CONTENT_LIMIT = 8000;

export const fetchPageToolInputSchema = z.object({
  url: z.url(),
});
export type FetchPageToolInput = z.infer<typeof fetchPageToolInputSchema>;

/** Successful fetch: normalized page content, cut at FETCH_CONTENT_LIMIT. */
export const fetchPageResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  content: z.string(),
  truncated: z.boolean(),
});
export type FetchPageResult = z.infer<typeof fetchPageResultSchema>;

/**
 * Tool output: either the serving provider plus the normalized page content,
 * or a graceful failure the model can react to (normal tool output, never
 * thrown — same pattern as searchWeb).
 */
export const fetchPageToolOutputSchema = z.union([
  fetchPageResultSchema.extend({
    provider: searchProviderSchema,
    /** Per-turn citation number (R14) — same counter as searchWeb results.
     * Optional so pre-R14 persisted outputs still parse. */
    num: z.number().int().positive().optional(),
  }),
  z.object({
    error: z.literal("fetch_failed"),
    attemptedProviders: z.array(searchProviderSchema),
  }),
]);
export type FetchPageToolOutput = z.infer<typeof fetchPageToolOutputSchema>;
