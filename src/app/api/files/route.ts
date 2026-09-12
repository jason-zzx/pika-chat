import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { requireActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { sweepOrphanFiles, uploadFile } from "@/server/files/file.service";

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
