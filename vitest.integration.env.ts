try {
  process.loadEnvFile(".env");
} catch {
  // Vars may already be in the environment.
}

process.env.DATABASE_PATH = ":memory:";
delete process.env.DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
  "test-credential-encryption-secret-min-32";

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.includes("models.dev")) {
    return Promise.resolve(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return originalFetch(input, init);
}) as typeof fetch;

