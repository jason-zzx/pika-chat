import { z } from "zod";

import { MAX_QUOTA_MB } from "@/lib/files/constants";

/**
 * PATCH body for `/api/admin/users/[userId]/quota`. `null` clears the override
 * so the user follows the instance-wide default; a non-negative integer is a
 * per-user cap in MB.
 */
export const userQuotaRequestSchema = z.object({
  quotaMb: z.number().int().nonnegative().max(MAX_QUOTA_MB).nullable(),
});

export type UserQuotaRequest = z.infer<typeof userQuotaRequestSchema>;

/** Response of GET/PATCH `/api/admin/users/[userId]/quota`. */
export const userQuotaResponseSchema = z.object({
  userId: z.string().min(1),
  quotaBytes: z.number().int().nonnegative().nullable(),
});

export type UserQuotaResponse = z.infer<typeof userQuotaResponseSchema>;
