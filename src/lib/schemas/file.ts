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

/** Response of `GET /api/files/limits` (see src/app/api/files/limits/route.ts). */
export const fileLimitsSchema = z.object({
  maxFileBytes: z.number().int().positive(),
  maxAttachmentsPerMessage: z.number().int().positive(),
  directUpload: z.boolean(),
  // Current storage usage and effective quota. `quotaBytes` is null only when
  // both the per-user override and the instance default are cleared.
  usedBytes: z.number().int().nonnegative(),
  // Zero is a legitimate quota (an admin may cap a user at 0 bytes), so this
  // must be nonnegative — `.positive()` here would make the client reject an
  // entirely valid limits payload and fall back to "unlimited".
  quotaBytes: z.number().int().nonnegative().nullable(),
});
export type FileLimits = z.infer<typeof fileLimitsSchema>;

/** Request body of `POST /api/files/presign` (see presign/route.ts). */
export const presignFileRequestSchema = z.object({
  // Empty is tolerated: `presignFile` falls back to "file" exactly as the
  // relay path does.
  filename: z.string(),
  // Empty is legitimate: several browsers report `""` for code/text files and
  // the server infers the stored type from the extension.
  mediaType: z.string(),
});
export type PresignFileRequest = z.infer<typeof presignFileRequestSchema>;

/** Response of `POST /api/files/presign`: a pending row plus an upload policy. */
export const presignedUploadSchema = z.object({
  fileId: z.string().min(1),
  post: z.object({
    url: z.string().min(1),
    fields: z.record(z.string(), z.string()),
  }),
});
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;

/** Request body of `POST /api/files/complete` (see complete/route.ts). */
export const completeFileRequestSchema = z.object({
  fileId: z.string().min(1),
});
export type CompleteFileRequest = z.infer<typeof completeFileRequestSchema>;
