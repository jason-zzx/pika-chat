import { z } from "zod";

export const demoLimitBucketSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});

export const demoUsageResponseSchema = z.object({
  model: demoLimitBucketSchema,
  search: demoLimitBucketSchema,
  upload: demoLimitBucketSchema,
});

export type DemoUsageResponse = z.infer<typeof demoUsageResponseSchema>;
