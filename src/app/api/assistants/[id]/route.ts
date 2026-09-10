import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { updateAssistantSchema } from "@/lib/schemas/assistant";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  deleteAssistant,
  updateAssistant,
} from "@/server/services/assistant.service";

async function assistantId(
  context: { params: Promise<Record<string, string>> } | undefined,
): Promise<string> {
  const id = (await context?.params)?.id;
  if (!id) {
    throw new AppError("NOT_FOUND", 404, "assistant.notFound");
  }
  return id;
}

export const PATCH = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const input = updateAssistantSchema.parse(await request.json());
  const assistant = await updateAssistant(
    await assistantId(context),
    input,
    actor,
  );
  return Response.json(assistant);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  await deleteAssistant(await assistantId(context), actor);
  return new Response(null, { status: 204 });
});
