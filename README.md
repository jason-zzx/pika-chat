<p align="center">
  <img src="src/app/icon.svg" width="96" height="96" alt="Pika Chat logo" />
</p>

<h1 align="center">Pika Chat</h1>

<p align="center">
  <strong>A modern, self-hosted, multimodal AI chat workspace built for speed, privacy, and control.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Drizzle_ORM-PostgreSQL-c5f74f?logo=drizzle" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker Ready" />
</p>

---

**Pika Chat** is a privacy-conscious, self-hosted AI chat platform designed for both individual power users and teams. Connect your own LLM providers, search the live web with citations, upload and parse multimodal files, and organize workflows with assistants and topics — all in a clean, responsive interface that works just as smoothly on mobile touchscreens as it does on multi-monitor desktops.

---

## Highlights

- **Zero-Maintenance Philosophy**: Ships with sensible defaults out of the box — local disk storage, auto-migrating database schemas, auto-creating S3 buckets, and automatic orphan file cleanup.
- **Privacy & Security First**: Provider API keys encrypted with authenticated AES-256-GCM at rest; role-based access control, TOTP 2-Factor Authentication, and isolated storage quotas.
- **Universal Multimodal Support**: Drag-and-drop images, documents (PDF, DOCX, XLSX, PPTX, EPUB, TXT, Markdown), audio, and video with instant text extraction and dynamic model conversion.
- **High-Performance Architecture**: Next.js 16 App Router, React 19, Tailwind CSS v4, streaming responses with smooth scroll pinning, and optional direct S3 byte transfers.

---

## Key Features

### 🤖 Multi-Provider & Model Orchestration
- **Universal Endpoint Support**: Connect OpenAI, Anthropic (Claude), Google Gemini, Ollama, OpenRouter, DeepSeek, Groq, Mistral, Moonshot, or any OpenAI-compatible API gateway.
- **Endpoint Auto-Discovery**: Fetch available models directly from your endpoint (`/v1/models`) with one click.
- **Granular Model Settings**: Customize context window limits, reasoning effort (thinking tokens), input modalities, and custom vendor icons per model.
- **Credential Encryption**: API keys are encrypted at rest with authenticated AES-256-GCM (`CREDENTIAL_ENCRYPTION_SECRET`). Keys are never exposed to clients or logged.
- **Private & Shared Configurations**: Share vetted provider configs across all instance members, or keep custom keys personal.

### 💬 Seamless Conversational Experience
- **Non-Tail Regeneration**: Regenerate any prior assistant turn without truncating or modifying subsequent conversation turns. Branching message versions are tracked via `group_id` and server-persisted selection states.
- **Rich Markdown & Code Rendering**: Powered by Streamdown with real-time KaTeX math formulas, interactive Mermaid diagrams, syntax-highlighted code blocks with one-click copying, and CJK-friendly typography.
- **Smart Scroll Management**: Tail message reserve space prevents layout jumps during streaming, while gesture-based unpinning respects wheel and touch scrolls.
- **Mobile-First UX**: Responsive split-column layout, tap-to-reveal message actions (no hover-only dependencies), and non-modal dropdowns designed for touch interactions.
- **Assistants & Topics**: Create custom assistants with dedicated system instructions and default models. Pin topics, search conversation history, and export dialogues.

### 📎 Multimodal Attachments & Document Parsing
- **Wide Format Support**:
  - **Documents**: PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), EPUB, Plain Text, and Markdown.
  - **Media**: JPEG, PNG, GIF, WebP, WAV, MP3, MPEG, MP4, WebM.
- **Upload-Time Document Extraction**: Documents are parsed at upload time with page counts, word statistics, and C0 control byte sanitization, displayed as preview chips before sending.
- **Dynamic Model Replay**: Automatically supplies native multimodal payloads to vision/audio models and falls back to parsed text when switching to text-only models across turns.
- **Provider Files API Integration**: Native support for Gemini and Anthropic Files APIs with expiration tracking and lazy re-upload handling.

### 🔍 Real-Time Web Search with Citations
- **LLM Function Calling**: The model autonomously decides when external search is required.
- **Multi-Provider Search**: Plug in Brave Search, Tavily, Exa, or Firecrawl with configurable fallback priority chains.
- **Deep Page Scraping**: Uses `fetchPage` tool extraction to retrieve full web page contents for in-depth answers.
- **Deterministic Citations**: Unique, turn-wide sequential citation tags (`[1]`, `[2]`) linked to verified web sources.

### 🗄️ Pluggable Storage: Local Disk & S3-Compatible
- **Zero-Config Local Storage**: Attachments default to local disk storage (`.data/files`) without any third-party infrastructure required.
- **S3-Compatible Object Storage**: Point `S3_BUCKET` to AWS S3, MinIO, Cloudflare R2, or RustFS. The bucket is automatically bootstrapped on first access.
- **Direct S3 Access (`S3_DIRECT_ACCESS=1`)**: Offload app server bandwidth — browsers upload directly to the bucket via presigned POST policies and download/preview via 302 presigned GET redirects.
- **Bundled RustFS Compose**: One command deploys an all-in-one stack with self-hosted S3-compatible storage.

### 🛡️ Authentication, RBAC & Storage Quotas
- **Better Auth Engine**: Built-in credential authentication with email/password and TOTP Two-Factor Authentication (2FA).
- **First-Run Setup Wizard**: Guided initial setup at `/setup` to bootstrap the first Super Admin safely without database fiddling.
- **Role Hierarchy**: Strict permission gates for Super Admin, Admin, and Member roles.
- **Storage Quotas**: Per-user storage limits and instance-wide global quotas (default 5 GiB) with automatic orphan cleanup sweeps.
- **Instance Governance**: Toggle registration status (open/closed), ban malicious accounts, and reset user credentials from the admin dashboard.

### 🌐 Internationalization (i18n)
- Ships with complete **English** and **Simplified Chinese** (简体中文) localizations, switchable instantly per browser under **Settings → General**.

---

## Quick Start

### Option 1: Production All-in-One (`docker-compose.full.yml`, Recommended)

Runs Pika Chat, PostgreSQL, and RustFS (S3-compatible attachment storage) together in an all-in-one stack with persistent volumes and automatic migrations on boot. Pulls the official prebuilt image (`ghcr.io/jason-zzx/pika-chat:latest`) by default.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and configure your instance secrets. Generate 32+ character secrets with:
   ```bash
   openssl rand -base64 48
   ```
   Fill them into `.env`:
   ```env
   CREDENTIAL_ENCRYPTION_SECRET=your-generated-encryption-secret
   BETTER_AUTH_SECRET=your-generated-auth-secret
   POSTGRES_PASSWORD=your-db-password
   ```

3. **Launch all-in-one stack**:
   ```bash
   docker compose -f docker-compose.full.yml up -d
   ```

4. **Initialize Super Admin**:
   Open **`http://localhost:3000/setup`** in your browser to create the first administrator account.

---

### Option 2: Production Standalone (`docker-compose.standalone.yml`)

If you already have an existing PostgreSQL database (e.g. AWS RDS, Supabase, Neon, or self-hosted) and optional external S3 storage, run the application container alone without launching redundant local containers:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to connect to your external PostgreSQL database:
   ```env
   # Method A: Provide a single connection string
   DATABASE_URL=postgres://user:password@your-pg-host:5432/pika_chat

   # Method B: Or provide discrete variables (credentials are automatically URL-encoded)
   # POSTGRES_HOST=your-pg-host
   # POSTGRES_PORT=5432
   # POSTGRES_USER=user
   # POSTGRES_PASSWORD=password
   # POSTGRES_DB=pika_chat

   CREDENTIAL_ENCRYPTION_SECRET=your-generated-encryption-secret
   BETTER_AUTH_SECRET=your-generated-auth-secret

   # Optional: configure external S3 storage
   # S3_BUCKET=my-bucket
   # S3_ACCESS_KEY_ID=...
   # S3_SECRET_ACCESS_KEY=...
   ```

3. **Launch standalone application**:
   ```bash
   docker compose -f docker-compose.standalone.yml up -d
   ```

---

### Option 3: Local Development (`docker-compose.dev.yml`)

#### Prerequisites
- **Node.js**: >= 22
- **pnpm**: 11.9+
- **Docker** or **Podman** (for local PostgreSQL database)

#### Step-by-Step

1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   pnpm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set `CREDENTIAL_ENCRYPTION_SECRET` and `BETTER_AUTH_SECRET` with values from `openssl rand -base64 48`.

3. **Start local PostgreSQL development database**:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

4. **Run database migrations**:
   ```bash
   pnpm db:migrate
   ```

5. **Start development server**:
   ```bash
   pnpm dev
   ```

6. Visit **`http://localhost:3000/setup`** to complete initial administrator initialization.

---

## Configuration Reference

Configure Pika Chat through environment variables in your `.env` file or deployment container environment:

| Variable | Required | Default | Description |
|---|:---:|:---:|---|
| `DATABASE_URL` | **Yes\*** | — | PostgreSQL connection URI (e.g. `postgres://pika:pika@localhost:5432/pika_chat`). \*Alternatively, provide discrete `POSTGRES_*` variables. |
| `POSTGRES_HOST` | No | `localhost` / `postgres` | Hostname of external PostgreSQL server (used when `DATABASE_URL` is omitted). |
| `POSTGRES_PORT` | No | `5432` | Port of external PostgreSQL server. |
| `POSTGRES_USER` | No | `postgres` / `pika` | Username for PostgreSQL (auto-encoded). |
| `POSTGRES_PASSWORD` | No | — | Password for PostgreSQL (auto-encoded). |
| `POSTGRES_DB` | No | `pika_chat` | Database name. |
| `CREDENTIAL_ENCRYPTION_SECRET` | **Yes** | — | Secret key (min 32 chars) used for AES-256-GCM encryption of provider API keys at rest. **Do not lose this**; losing it orphans stored credentials permanently. |
| `BETTER_AUTH_SECRET` | **Yes** | — | Secret key (min 32 chars) used for signing Better Auth session tokens. |
| `APP_URL` | No | `http://localhost:3000` | Canonical public URL of your deployment. Required when deployed behind reverse proxies. |
| `APP_TRUSTED_ORIGINS` | No | — | Additional comma-separated trusted origins for CSRF checks and multi-address access (e.g. `http://192.168.1.100:3000,https://chat.example.com`). |
| `FILE_STORAGE_DIR` | No | `.data/files` | Local filesystem directory for storing uploaded chat attachments when S3 is not configured. |
| `FILE_UPLOAD_MAX_MB` | No | `20` | Maximum size for a single file attachment in MiB (allowed integer range: `1`–`100`). Fails fast on invalid values. |
| `S3_BUCKET` | No | — | Setting this switches attachment storage from local disk to S3-compatible object storage. Automatically bootstraps bucket if missing. |
| `S3_ENDPOINT` | No | official AWS | Custom S3 endpoint URL (e.g. `http://minio:9000` or `https://<account>.r2.cloudflarestorage.com`). Automatically forces path-style addressing for non-AWS hosts. |
| `S3_REGION` | No | `us-east-1` | S3 region identifier. |
| `S3_ACCESS_KEY_ID` | If S3 set | — | S3 access key credential. |
| `S3_SECRET_ACCESS_KEY` | If S3 set | — | S3 secret access key credential. |
| `S3_DIRECT_ACCESS` | No | `false` | Set to `1` or `true` to enable direct browser S3 uploads (presigned POST) and downloads (presigned 302 GET), bypassing server transfer. Requires `S3_BUCKET`. |
| `PIKA_IMAGE` | No | `ghcr.io/jason-zzx/pika-chat:latest` | Container image tag override in Docker Compose. |
| `TEST_DATABASE_URL` | Dev only | — | Dedicated test database URI (e.g. `postgres://pika:pika@localhost:5432/pika_chat_test`) for running Vitest integration tests. |

---

## Storage Architecture

```
                                  +-----------------------+
                                  |  Local Disk Storage   |
                                  |  (FILE_STORAGE_DIR)   |
                                  +-----------^-----------+
                                              |
+----------+      Upload / Download           | (default)
|  Client  | <=========================> [ App Server ]
+----+-----+                                  |
     |                                        | (if S3_BUCKET set)
     | (if S3_DIRECT_ACCESS=1)                v
     |                             +----------------------+
     +---------------------------> | S3-Compatible Store  |
        Direct Presigned POST/GET  | AWS S3 / MinIO /     |
                                   | RustFS / R2          |
                                   +----------------------+
```

- **Local Storage**: Files are saved with content-addressed naming under `FILE_STORAGE_DIR`. In Docker, persist this directory using a named volume or host bind mount.
- **S3 Storage**: When `S3_BUCKET` is configured, file operations transparently target the S3 bucket. Buckets are auto-created on first access.
- **Direct S3 Transfer**: With `S3_DIRECT_ACCESS=1`, browsers upload directly to S3 via short-lived presigned POST policies and download via 302 redirects to presigned GET URLs. Ensure your S3 bucket CORS configuration permits `POST` from the application domain:
  ```json
  [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["POST", "GET", "HEAD"],
      "AllowedOrigins": ["https://your-chat-domain.com"],
      "ExposeHeaders": ["ETag"]
    }
  ]
  ```

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Standalone output)
- **UI Library**: [React 19](https://react.dev/), [Base UI](https://base-ui.com/), [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/)
- **AI Integration**: [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- **Database & ORM**: [PostgreSQL 17](https://www.postgresql.org/), [Drizzle ORM](https://orm.drizzle.team/), [postgres.js](https://github.com/porsager/postgres)
- **Authentication**: [Better Auth](https://better-auth.com/) with TOTP Two-Factor Authentication
- **Content & Markdown**: [Streamdown](https://github.com/streamdown/streamdown), KaTeX, Mermaid, `@streamdown/cjk`, `@streamdown/math`, `@streamdown/mermaid`
- **Document Extractors**: `unpdf` (PDF), `mammoth` (DOCX), `xlsx` (Excel), `jszip` (EPUB/PPTX)
- **Object Storage**: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`
- **Internationalization**: [next-intl](https://next-intl.dev/)
- **Testing**: [Vitest](https://vitest.dev/), React Testing Library, PostgreSQL integration test harness

---

## Development & Verification

Before submitting code, ensure all quality gates pass:

```bash
# Code style and linting
pnpm lint

# TypeScript static type check
pnpm typecheck

# Full unit and integration test suite (requires local Postgres running)
pnpm test
```

Database schema migrations:
```bash
# Generate new migration files from Drizzle schema changes
pnpm db:generate

# Apply migrations to database
pnpm db:migrate
```

---

## License

This project is licensed under the MIT License.
