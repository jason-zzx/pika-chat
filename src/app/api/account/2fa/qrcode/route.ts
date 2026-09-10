import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { qrCodeSchema } from "@/lib/schemas/two-factor";
import { requireActor } from "@/server/auth/actor";
import { renderTotpQrCode } from "@/server/services/two-factor.service";

export const POST = withErrorHandling(async (request) => {
  // Authentication gate only — the render touches no stored secret and no
  // user-owned row, so the resolved actor is not needed downstream.
  await requireActor(request.headers);
  const input = qrCodeSchema.parse(await request.json());
  const dataUrl = await renderTotpQrCode(input);
  return Response.json({ dataUrl });
});
