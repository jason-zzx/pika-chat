import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { getInstanceState } from "@/server/services/instance-settings.service";

export const GET = withErrorHandling(async () => {
  const state = await getInstanceState();
  return Response.json(state);
});
