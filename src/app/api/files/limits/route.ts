import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import { requireActor } from "@/server/auth/actor";
import {
  isS3DirectAccessEnabled,
  maxFileBytes,
} from "@/server/files/limits";

/**
 * Upload capabilities the composer needs before choosing a transport. Values
 * are read per request so an env change is reflected without a redeploy of the
 * client bundle.
 */
export const GET = withErrorHandling(async (request) => {
  await requireActor(request.headers);
  return Response.json({
    maxFileBytes: maxFileBytes(),
    maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    directUpload: isS3DirectAccessEnabled(),
  });
});
