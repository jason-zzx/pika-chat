# pika-chat

Self-hosted AI chat. Phase 1 is text chat with a responsive layout, provider
and model configuration, assistants and topics, and basic user management.

## Quick start

Requires Node 22+, pnpm 11.9, and Docker (or Podman with Compose). Images use
fully qualified names (`docker.io/library/...`) so short-name-restricted
runtimes do not prompt. The Postgres init-script bind mount uses `:Z` for
SELinux.

```bash
cp .env.example .env
# Replace the two secret placeholders. Generate values with:
#   openssl rand -base64 48

docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. Health: http://localhost:3000/api/health

`pnpm lint`, `pnpm typecheck`, and `pnpm test` must pass before work is
reported complete. Integration tests talk to `pika_chat_test` on the same
Postgres instance; they fail if that database is unreachable (they never skip).

Local development uses `pnpm dev`. The Docker image is built with
`DOCKER_BUILD=1` so Next.js emits standalone output; that is the self-host
path, and it applies pending migrations on boot.

## Secrets

`CREDENTIAL_ENCRYPTION_SECRET` encrypts provider API keys at rest. Losing it
makes every stored credential permanently unrecoverable — it is not derivable
from the database. Generate it once, back it up with the rest of the instance,
and do not rotate it casually.

## Production compose

```bash
export CREDENTIAL_ENCRYPTION_SECRET=...
export BETTER_AUTH_SECRET=...
docker compose -f docker-compose.prod.yml up --build
```
