import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { withSessionCookies } from "@/app/api/_lib/session-response";
import { credentialsSchema } from "@/lib/schemas/credentials";
import { auth } from "@/server/auth";
import { registerUser } from "@/server/services/registration.service";

export const POST = withErrorHandling(async (request) => {
  const input = credentialsSchema.parse(await request.json());
  const user = await registerUser(input);
  const signIn = await auth.api.signInEmail({
    body: { email: input.email, password: input.password },
    headers: request.headers,
    asResponse: true,
  });
  return withSessionCookies(user, signIn, 201);
});
