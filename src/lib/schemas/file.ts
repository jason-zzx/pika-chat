import { z } from "zod";

/** Extraction state the upload endpoint reports for a fresh attachment. */
export const fileExtractionStateSchema = z.enum([
  "none",
  "ok",
  "empty",
  "failed",
]);
export type FileExtractionState = z.infer<typeof fileExtractionStateSchema>;

/** Response of `POST /api/files` (see src/app/api/files/route.ts). */
export const uploadedFileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  extraction: z.object({
    status: fileExtractionStateSchema,
    truncated: z.boolean(),
  }),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;
