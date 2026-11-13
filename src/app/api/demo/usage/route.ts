import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";
import { isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { getGuestUsage } from "@/server/services/demo-usage.service";

export const GET = withErrorHandling(async (request) => {
  if (!isDemoMode()) {
    throw new AppError("NOT_FOUND", 404, "demo.notFound");
  }
  const actor = await requireActor(request.headers);
  if (!actor.isGuest) {
    throw new AppError("NOT_FOUND", 404, "demo.notFound");
  }
  const usage = await getGuestUsage(actor.userId);
  return Response.json(usage);
});
