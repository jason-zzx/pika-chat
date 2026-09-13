import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { presignFileRequestSchema } from "@/lib/schemas/file";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { presignFile, sweepOrphanFiles } from "@/server/files/file.service";
import { isS3DirectAccessEnabled } from "@/server/files/limits";

/**
 * Issues a presigned POST for a direct browser→storage upload. The endpoint's
 * existence *is* the switch: with `S3_DIRECT_ACCESS` off it answers 404 so a
 * client cannot opt into a transport the deployment did not enable.
 */
export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  if (!isS3DirectAccessEnabled()) {
    throw new AppError("NOT_FOUND", 404, "file.notFound");
  }
  const body = presignFileRequestSchema.parse(await request.json());
  const presigned = await presignFile(body, actor);

  // Best-effort, never throws. Covers the user who presigns and never
  // completes: the sweep only reclaims rows older than the 24h TTL, so the
  // pending row just inserted here is untouched, while a previous abandoned
  // upload (and the provider-delete retry queue) gets reclaimed.
  await sweepOrphanFiles(actor);

  return Response.json(presigned, { status: 201 });
});
