import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { checkHealth } from "@/server/services/health.service";

export const GET = withErrorHandling(async () => {
  const result = await checkHealth();
  return Response.json(result);
});
