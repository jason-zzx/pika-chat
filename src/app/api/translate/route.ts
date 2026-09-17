import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { translateMessageRequestSchema } from "@/lib/schemas/chat";
import { requireActor } from "@/server/auth/actor";
import { translateMessage } from "@/server/services/translation.service";

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = translateMessageRequestSchema.parse(await request.json());
  const result = await translateMessage(input, actor);
  return Response.json(result);
});
