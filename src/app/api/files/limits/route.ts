import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/files/constants";
import { requireActor } from "@/server/auth/actor";
import {
  isS3DirectAccessEnabled,
  maxFileBytes,
} from "@/server/files/limits";
import { effectiveQuotaBytes, usageBytes } from "@/server/files/quota";

/**
 * Upload capabilities the composer needs before choosing a transport. Values
 * are read per request so an env change is reflected without a redeploy of the
 * client bundle. `usedBytes`/`quotaBytes` are what the composer shows a
 * rejected upload against (and what the admin usage view will read).
 */
export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const [usedBytes, quotaBytes] = await Promise.all([
    usageBytes(actor.userId),
    effectiveQuotaBytes(actor),
  ]);
  return Response.json({
    maxFileBytes: maxFileBytes(),
    maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    directUpload: isS3DirectAccessEnabled(),
    usedBytes,
    quotaBytes,
  });
});
