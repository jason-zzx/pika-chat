import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_.]+$/, "Username may only contain letters, numbers, underscores, and dots");

export const passwordSchema = z.string().min(8).max(128);

export const credentialsSchema = z.object({
  username: usernameSchema,
  email: z.email(),
  password: passwordSchema,
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;
