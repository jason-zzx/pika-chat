# pika-chat

Self-hosted AI chat. Phase 1 is text chat with a responsive layout, provider
and model configuration, assistants and topics, and basic user management.
The UI ships in English and Simplified Chinese, switchable per browser under
Settings → General.

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

`BETTER_AUTH_SECRET` signs session tokens. Rotating it invalidates every
existing session; users will need to sign in again. That is inconvenient, not
data loss.

A fresh instance has registration closed. Visit `/setup` to create the first
super admin, then provision other accounts from `/settings/users`.

## Production compose

```bash
export CREDENTIAL_ENCRYPTION_SECRET=...
export BETTER_AUTH_SECRET=...
docker compose -f docker-compose.prod.yml up --build
```

Uploaded chat attachments are written to `FILE_STORAGE_DIR` (default
`.data/files`). The production compose file mounts a `files_prod_data` named
volume at `/data/files`; keep that volume (or a host bind mount) in any custom
deployment — attachment bytes are not stored in the database and are lost if
the directory is not persisted.

A single attachment is capped at 20 MiB by default. Set `FILE_UPLOAD_MAX_MB`
to a value between 1 and 100 to change it; a value outside that range makes
the server refuse to start.

## S3-compatible attachment storage

Attachments default to local disk. Set `S3_BUCKET` to move them to any
S3-compatible object store (AWS S3, MinIO, RustFS, R2); leave it unset and
nothing changes. `S3_BUCKET` wins when both it and `FILE_STORAGE_DIR` are set.

```bash
S3_BUCKET=pika-attachments
S3_ENDPOINT=http://minio:9000        # omit for the official AWS endpoint
S3_REGION=us-east-1                  # optional, defaults to us-east-1
S3_ACCESS_KEY_ID=...                 # required whenever S3_BUCKET is set
S3_SECRET_ACCESS_KEY=...             # required whenever S3_BUCKET is set
```

Setting a custom `S3_ENDPOINT` automatically switches requests to path-style
URLs, which MinIO/RustFS-style endpoints on a container network require; the
official AWS endpoint keeps the virtual-hosted default.

The bucket is created on first use if it does not exist, so there is nothing to
provision by hand. Credentials are read from the environment only and are never
logged. Removing the `S3_*` variables switches back to local disk; objects
already written to the bucket are not copied back.

### Direct S3 access

By default the browser uploads to the app server, which relays the bytes to
storage, and downloads/previews are relayed the same way. With S3 configured,
set `S3_DIRECT_ACCESS=1` to let the browser talk to the bucket directly in
both directions: uploads use a short-lived presigned POST policy, and
downloads/previews get a 302 redirect to a presigned GET — the bytes never
pass through the app process, and S3 serves Range requests natively.

```bash
S3_DIRECT_ACCESS=1    # requires S3_BUCKET; default off
```

Direct uploads require the bucket's CORS configuration to allow browser POSTs
from the app's origin; the 302 downloads need no CORS setup because the
browser simply follows a redirect. The size limit is still enforced on both
ends (the signed policy and the server-side completion check), so a client
cannot upload past `FILE_UPLOAD_MAX_MB`. Direct access requires S3: enabling
the flag without `S3_BUCKET` makes the server refuse to start rather than
silently falling back to the relay path, so every deployment of the same
environment behaves alike.

### Bundled RustFS deployment

To run attachment storage in a container alongside the app, stack the override
file on top of the production compose file. `docker-compose.prod.yml` itself is
unchanged:

```bash
export CREDENTIAL_ENCRYPTION_SECRET=...
export BETTER_AUTH_SECRET=...
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
export S3_BUCKET=pika-attachments    # optional, this is the default
docker compose -f docker-compose.prod.yml -f docker-compose.prod.rustfs.yml up --build
```

RustFS listens on `9000` inside the compose network only; its console (`9001`)
is not published to the host. Add `ports: ["9001:9001"]` to the `rustfs`
service in a further override if you want it reachable.
