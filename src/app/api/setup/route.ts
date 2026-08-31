import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { withSessionCookies } from "@/app/api/_lib/session-response";
import { credentialsSchema } from "@/lib/schemas/credentials";
import { auth } from "@/server/auth";
import { createFirstAdmin } from "@/server/services/setup.service";

export const POST = withErrorHandling(async (request) => {
  const input = credentialsSchema.parse(await request.json());
  const admin = await createFirstAdmin(input);
  const signIn = await auth.api.signInEmail({
    body: { email: input.email, password: input.password },
    headers: request.headers,
    asResponse: true,
  });
  return withSessionCookies(admin, signIn, 201);
});
