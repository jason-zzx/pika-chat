import { z } from "zod";

import { MAX_QUOTA_MB } from "@/lib/files/constants";

/**
 * PATCH body for `/api/admin/settings`. Both fields are optional so a caller
 * can flip one without resending the other — `fileStorageQuotaMb: null` means
 * unlimited (the UI maps a blank input to null).
 */
export const instanceSettingsSchema = z.object({
  allowRegistration: z.boolean().optional(),
  fileStorageQuotaMb: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_QUOTA_MB)
    .nullable()
    .optional(),
});

export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;

/** Full instance settings as returned by GET/PATCH `/api/admin/settings`. */
export const instanceSettingsResponseSchema = z.object({
  allowRegistration: z.boolean(),
  fileStorageQuotaMb: z.number().int().nonnegative().nullable(),
});

export type InstanceSettingsResponse = z.infer<
  typeof instanceSettingsResponseSchema
>;
