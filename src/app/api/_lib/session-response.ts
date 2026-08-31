export function withSessionCookies(
  body: unknown,
  signIn: Response,
  status: number,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of signIn.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  const token = signIn.headers.get("set-auth-token");
  if (token) {
    headers.set("set-auth-token", token);
  }
  return new Response(JSON.stringify(body), { status, headers });
}
