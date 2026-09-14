import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { fileListQuerySchema } from "@/lib/schemas/file";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import {
  listFilesForActor,
  sweepOrphanFiles,
  uploadFile,
} from "@/server/files/file.service";

export const POST = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION_FAILED", 400, "file.unsupportedType");
  }

  const uploaded = await uploadFile(
    {
      filename: file.name,
      mediaType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    },
    actor,
  );

  // Best-effort, never throws — reclaims this user's old unreferenced uploads.
  await sweepOrphanFiles(actor);

  return Response.json(uploaded, { status: 201 });
});

/**
 * The authenticated user's own attachment list, newest first. Scoped strictly
 * to the actor — there is no administrator view over other users' files; an
 * operator manages storage through the quota, not by reading content.
 */
export const GET = withErrorHandling(async (request) => {
  const actor = await requireActor(request.headers);
  const params = new URL(request.url).searchParams;
  const query = fileListQuerySchema.parse({
    offset: params.get("offset") ?? undefined,
    limit: params.get("limit") ?? undefined,
    category: params.get("category") ?? undefined,
  });

  const result = await listFilesForActor(actor, query);
  return Response.json(result);
});
