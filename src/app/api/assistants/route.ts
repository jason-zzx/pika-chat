import { getTranslations } from "next-intl/server";

import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { createAssistantSchema } from "@/lib/schemas/assistant";
import { requireActor } from "@/server/auth/actor";
import {
  createAssistant,
  listAssistantTree,
} from "@/server/services/assistant.service";

export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  // The seeded assistant name is stored data; resolve it here at the
  // transport boundary (services stay transport-agnostic).
  const t = await getTranslations("Assistant");
  const tree = await listAssistantTree(actor, t("defaultName"));
  return Response.json(tree);
});

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const input = createAssistantSchema.parse(await request.json());
  const assistant = await createAssistant(input, actor);
  return Response.json(assistant, { status: 201 });
});
