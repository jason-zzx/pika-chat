process.env.DATABASE_PATH = ":memory:";
delete process.env.DATABASE_URL;
for (const key of [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
]) {
  delete process.env[key];
}
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
  "test-credential-encryption-secret-min-32";
