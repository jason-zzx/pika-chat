import { z } from "zod";

export const instanceStateSchema = z.object({
  needsSetup: z.boolean(),
  allowRegistration: z.boolean(),
  demo: z.boolean(),
});

export type InstanceState = z.infer<typeof instanceStateSchema>;
