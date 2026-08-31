import { z } from "zod";

export const instanceSettingsSchema = z.object({
  allowRegistration: z.boolean(),
});

export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;
