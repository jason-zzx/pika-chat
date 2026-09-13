import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { userQuotaRequestSchema } from "@/lib/schemas/user-quota";
import { requireAdmin } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  getUserQuota,
  updateUserQuota,
} from "@/server/services/user-quota.service";

/** The path param is present for a matched route; a missing one is a 404. */
async function userIdFrom(context?: {
  params: Promise<Record<string, string>>;
}): Promise<string> {
  const userId = (await context?.params)?.userId;
  if (!userId) {
    throw new AppError("NOT_FOUND", 404, "auth.userNotFound");
  }
  return userId;
}

export const GET = withErrorHandling(async (request, context) => {
  await requireAdmin(request.headers);
  return Response.json(await getUserQuota(await userIdFrom(context)));
});

export const PATCH = withErrorHandling(async (request, context) => {
  const actor = await requireAdmin(request.headers);
  const input = userQuotaRequestSchema.parse(await request.json());
  const result = await updateUserQuota(
    await userIdFrom(context),
    input.quotaMb,
    actor,
  );
  return Response.json(result);
});
