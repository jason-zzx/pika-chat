import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { createAssistantSchema } from "@/lib/schemas/assistant";
import { requireActor } from "@/server/auth/actor";
import {
  createAssistant,
  listAssistantTree,
} from "@/server/services/assistant.service";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const tree = await listAssistantTree(actor);
  return Response.json(tree);
});

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = createAssistantSchema.parse(await request.json());
  const assistant = await createAssistant(input, actor);
  return Response.json(assistant, { status: 201 });
});
