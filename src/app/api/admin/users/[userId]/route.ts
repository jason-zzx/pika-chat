import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireAdmin } from "@/server/auth/actor";
import { removeUser } from "@/server/services/user-delete.service";

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireAdmin(request.headers);
  const userId = await requireParam(context, "userId", "auth.userNotFound");
  await removeUser(userId, actor);
  return new Response(null, { status: 204 });
});
