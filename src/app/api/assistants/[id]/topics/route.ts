import { z } from "zod";

import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";
import { listTopicPage } from "@/server/services/topic.service";

const cursorSchema = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid cursor" });
      return z.NEVER;
    }
  })
  .pipe(z.tuple([z.string(), z.string()]));

export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const assistantId = await requireParam(context, "id", "assistant.notFound");
  const raw = new URL(request.url).searchParams.get("cursor");
  const cursor = raw ? cursorSchema.parse(raw) : null;
  const page = await listTopicPage(assistantId, cursor, actor);
  return Response.json({
    topics: page.topics,
    nextCursor: page.nextCursor
      ? Buffer.from(JSON.stringify(page.nextCursor)).toString("base64url")
      : null,
  });
});
