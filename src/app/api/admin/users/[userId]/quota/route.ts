import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { userQuotaRequestSchema } from "@/lib/schemas/user-quota";
import { requireAdmin } from "@/server/auth/actor";
import {
  getUserQuota,
  updateUserQuota,
} from "@/server/services/user-quota.service";

export const GET = withErrorHandling(async (request, context) => {
  await requireAdmin(request.headers);
  const userId = await requireParam(context, "userId", "auth.userNotFound");
  return Response.json(await getUserQuota(userId));
});

export const PATCH = withErrorHandling(async (request, context) => {
  const actor = await requireAdmin(request.headers);
  const input = userQuotaRequestSchema.parse(await request.json());
  const userId = await requireParam(context, "userId", "auth.userNotFound");
  const result = await updateUserQuota(userId, input.quotaMb, actor);
  return Response.json(result);
});
