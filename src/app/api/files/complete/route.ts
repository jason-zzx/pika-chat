import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { completeFileRequestSchema } from "@/lib/schemas/file";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { completeFile, sweepOrphanFiles } from "@/server/files/file.service";
import { isS3DirectAccessEnabled } from "@/server/files/limits";

/**
 * Finalizes a direct upload: verifies the object's real size, caches
 * extraction, and returns the same shape as `POST /api/files`. 404 when direct
 * upload is off, matching `presign`.
 */
export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  if (!isS3DirectAccessEnabled()) {
    throw new AppError("NOT_FOUND", 404, "file.notFound");
  }
  const body = completeFileRequestSchema.parse(await request.json());
  const uploaded = await completeFile(body.fileId, actor);

  // Best-effort, never throws — a direct deployment has no relay upload to
  // piggyback the sweep on, so the completion is what reclaims this user's old
  // unreferenced rows and drains the provider-delete retry queue.
  await sweepOrphanFiles(actor);

  return Response.json(uploaded);
});
