<p align="center">
  <img src="src/app/icon.svg" width="96" height="96" alt="Pika Chat logo" />
</p>

<h1 align="center">Pika Chat</h1>

<p align="center">
  <strong>A modern, self-hosted, multimodal AI chat workspace built for speed, privacy, and control.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a> •
  <a href="https://pika-demo.jasonzzx.com">Live Demo</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Drizzle_ORM-SQLite-c5f74f?logo=drizzle" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker Ready" />
</p>

---

**Pika Chat** is a privacy-conscious, self-hosted AI chat platform designed for both individual power users and teams. Connect your own LLM providers, generate and edit images, search the live web with citations, upload and parse multimodal files, and organize workflows with assistants and topics — all in a clean, responsive interface that works just as smoothly on mobile touchscreens as it does on multi-monitor desktops.

<p align="center">
  <img src="docs/screenshots/chat-conversation.png" alt="Pika Chat conversation with rich Markdown, LaTeX math, and syntax-highlighted code" />
</p>

---

## Live Demo

Try Pika Chat directly in your browser without creating an account: **[https://pika-demo.jasonzzx.com](https://pika-demo.jasonzzx.com)** 

- One-click guest access using preconfigured models and web search, with daily usage quotas.
- Conversations and uploaded files are isolated to your browser session and automatically purged after 7 days of inactivity (please avoid entering sensitive information).

---

## Highlights

- **Zero-Maintenance Philosophy**: Ships with sensible defaults out of the box — local disk storage, auto-migrating database schemas, auto-creating S3 buckets, and automatic orphan file cleanup.
- **Privacy & Security First**: Provider API keys encrypted with authenticated AES-256-GCM at rest; role-based access control, TOTP 2-Factor Authentication, and isolated storage quotas.
- **Universal Multimodal Support**: Drag-and-drop images, documents (PDF, DOCX, XLSX, PPTX, EPUB, TXT, Markdown), audio, and video with instant text extraction and dynamic model conversion.
- **High-Performance Architecture**: Next.js 16 App Router, React 19, Tailwind CSS v4, server-managed background generation with stream recovery, smooth scroll pinning, and optional direct S3 byte transfers.

---

## Key Features

### 🤖 Multi-Provider & Model Orchestration
- **Universal Endpoint Support**: Connect OpenAI, Anthropic (Claude), Google Gemini, Ollama, OpenRouter, DeepSeek, Groq, Mistral, Moonshot, or any OpenAI-compatible API gateway.
- **Endpoint Auto-Discovery**: Fetch available models directly from your endpoint (`/v1/models`) with one click.
- **Granular Model Settings**: Customize context window limits, reasoning effort (thinking tokens), input modalities, and custom vendor icons per model.
- **Credential Encryption**: API keys are encrypted at rest with authenticated AES-256-GCM (`CREDENTIAL_ENCRYPTION_SECRET`). Keys are never exposed to clients or logged.
- **Default Models**: Choose personal default models for chat, title generation, context compression, and translation — applied automatically across all sessions.
- **Private & Shared Configurations**: Share vetted provider configs across all instance members, or keep custom keys personal.

### 💬 Seamless Conversational Experience
- **Background Generation & Stream Recovery**: Generations run as server-managed tasks that survive tab closes, refreshes, topic switching, and sign-outs — returning to a topic picks up live streaming or shows the finished result without re-running the model, with periodic checkpoints and no extra deployment components required.
- **In-Place User Message Editing**: Edit any sent user message (text and attachments) directly in the conversation to create a new switchable version and automatically regenerate the assistant reply below it without truncating later turns.
- **Non-Tail Regeneration**: Regenerate any prior assistant turn without truncating or modifying subsequent conversation turns. Branching message versions are tracked via `group_id` and server-persisted selection states.
- **Per-Message Token & Latency Stats**: Each assistant reply displays input/output token counts and output speed (TPS), with an expandable card on hover or tap showing cache-hit tokens, hit rate, time to first token (TTFT), and total duration.
- **Rich Markdown & Code Rendering**: Powered by Streamdown with real-time KaTeX math formulas, interactive Mermaid diagrams, syntax-highlighted code blocks with one-click copying, and CJK-friendly typography.
- **Context History Compression**: Automatically compresses long conversations into rolling summaries at ~80% of the model context budget, with one-click manual compression and collapsible summary views in the message list.
- **On-Demand Message Translation**: Translate any question or answer into 8 languages with per-version persistent caching and preserved citation links.
- **Smart Scroll Management**: Tail message reserve space prevents layout jumps during streaming, while gesture-based unpinning respects wheel, touch, and scrollbar drag interactions.
- **Mobile-First UX**: Responsive split-column layout, tap-to-reveal message actions (no hover-only dependencies), and non-modal dropdowns designed for touch interactions.
- **Assistants & Topics**: Create custom assistants with dedicated system instructions and default models. Pin topics, sync tab titles with active conversations, and export dialogues.
- **Full-Text Message Search**: Instantly jump to any topic or message with global full-text search, a `Ctrl+K` command palette, and in-topic hit navigation.

### 📎 Multimodal Attachments & Document Parsing
- **Wide Format Support**:
  - **Documents**: PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), EPUB, Plain Text, and Markdown.
  - **Media**: JPEG, PNG, GIF, WebP, WAV, MP3, MPEG, MP4, WebM.
- **Upload-Time Document Extraction**: Documents are parsed at upload time with page counts, word statistics, and C0 control byte sanitization, displayed as preview chips before sending.
- **Dynamic Model Replay**: Automatically supplies native multimodal payloads to vision/audio models and falls back to parsed text when switching to text-only models across turns.
- **Provider Files API Integration**: Native support for Gemini and Anthropic Files APIs with expiration tracking and lazy re-upload handling.

### 🎨 AI Image Generation & Editing
- **Multi-Family Image Models**: Text-to-image and image editing across OpenAI gpt-image, Google Gemini image models, ByteDance Seedream, and Alibaba Wan / Qwen-Image.
- **Per-Model Parameter Presets**: Resolution, aspect ratio, quality, and batch count options validated against each model family's real constraints.
- **Reference-Image Editing**: Reuse any existing attachment as an edit reference — no re-uploads needed.
- **Quota-Aware Persistence**: Generated images are stored as first-class attachments under the same per-user storage quotas.

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

### 🌐 Themes & Internationalization
- **Curated Theme Presets**: 6 built-in presets (Paper, Graphite, Ocean, Forest, Rose, Violet) alongside the neutral default, each with light and dark palettes, persisted per user with flash-free server rendering.
- **Bilingual i18n**: Ships with complete **English** and **Simplified Chinese** (简体中文) localizations, switchable instantly per browser under **Settings → General**.

---

## Screenshots

| 🎨 AI Image Generation & Editing | 🌈 Theme Presets |
|:---:|:---:|
| ![AI image generation in a chat conversation](docs/screenshots/image-generation.png) | ![Theme preset picker in settings](docs/screenshots/settings-themes.png) |

<p align="center">
  <img src="docs/screenshots/mobile-chat.png" width="320" alt="Pika Chat mobile chat experience" /><br/>
  <sub>📱 Mobile-first, touch-friendly chat experience</sub>
</p>

---

## Quick Start

### Option 1: Production All-in-One (`docker-compose.full.yml`, Recommended)

Runs Pika Chat (with embedded SQLite stored on the `/data/files` volume at `/data/files/pika-chat.db`) and RustFS (S3-compatible attachment storage) together with persistent volumes and automatic database migrations on boot. Pulls the official prebuilt image (`ghcr.io/jason-zzx/pika-chat:latest`) by default.

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
   ```

3. **Launch all-in-one stack**:
   ```bash
   docker compose -f docker-compose.full.yml up -d
   ```

4. **Initialize Super Admin**:
   Open **`http://localhost:3000/setup`** in your browser to create the first administrator account.

---

### Option 2: Production Standalone (`docker-compose.standalone.yml`)

Run the application container alone without launching redundant storage containers — using embedded SQLite (`/data/files/pika-chat.db`) and local disk or optional external S3 storage:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to set your instance secrets and optional external S3 storage:
   ```env
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

### Option 3: Local Development

#### Prerequisites
- **Node.js**: >= 22
- **pnpm**: 11.9+

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
   Open `.env`, keep `DATABASE_PATH=.data/pika-chat.db` (or choose another path), and set `CREDENTIAL_ENCRYPTION_SECRET` and `BETTER_AUTH_SECRET` with values from `openssl rand -base64 48`.

3. **Start development server** (SQLite migrations run automatically at startup, or run `pnpm db:migrate` manually):
   ```bash
   pnpm dev
   ```

4. Visit **`http://localhost:3000/setup`** to complete initial administrator initialization.

---

## Data, Backups & Upgrades

An instance keeps all of its data in the `/data/files` volume (`files_prod_data`, named `pika-chat_files_prod_data` by Docker): the SQLite database `pika-chat.db` with its `pika-chat.db-wal` / `pika-chat.db-shm` files, and attachments stored on local disk. Attachments stored in S3 live in the bucket. Keep `CREDENTIAL_ENCRYPTION_SECRET` with your backups: without it, stored provider API keys cannot be decrypted.

### Backups

- **While stopped**: stop the app, copy the whole volume, then start it again:
  ```bash
  docker compose -f docker-compose.full.yml stop app
  docker run --rm -v pika-chat_files_prod_data:/data -v "$PWD":/backup alpine tar czf /backup/pika-chat-data.tgz -C /data .
  docker compose -f docker-compose.full.yml start app
  ```
- **While running**: make a consistent copy of the database with `sqlite3 /data/files/pika-chat.db ".backup <target-file>"`, then copy the attachments. The app image does not include the `sqlite3` CLI, so run it from another container or host that mounts the volume. Copying only `pika-chat.db` from a running instance can miss the newest writes, which are still in `pika-chat.db-wal`.

### Upgrading from PostgreSQL

Releases up to v1.0.0-rc.1 stored data in PostgreSQL. This version copies that database into SQLite by itself on its first boot:

1. **Change only the image.** Keep your current compose file and `.env` (or your existing container environment) unchanged for this first boot, so PostgreSQL keeps running and its connection settings still reach the app. If you pin the image with `PIKA_IMAGE`, set the new tag, then pull and restart with the compose file you deployed with:
   ```bash
   docker compose -f docker-compose.full.yml pull
   docker compose -f docker-compose.full.yml up -d
   ```
2. **The import runs at boot.** When the server finds the previous PostgreSQL connection settings and SQLite has no import marker, it reads PostgreSQL in one read-only snapshot, copies every table into `/data/files/pika-chat.db` in a single transaction, checks row counts and foreign keys, records the marker, and only then starts serving. The logs report each table. PostgreSQL is never written to.
3. **If the import fails**, the server does not start and logs the reason (for example, PostgreSQL is unreachable or the SQLite database already holds data). SQLite stays empty, so fixing the cause and restarting tries again. PostgreSQL must be on the v0.4.0 – v1.0.0-rc.1 schema; upgrade older instances to v0.4.2 first.
4. **After the import**, later boots ignore the PostgreSQL settings. Switch to the current compose file (it has no `postgres` service) and run `docker compose -f docker-compose.full.yml up -d --remove-orphans`. Keep the old PostgreSQL volume until you have checked your data; going back only takes the previous image and compose file.

> **Switch compose files only after the import.** The current compose files no longer connect to PostgreSQL, so booting with them first starts a fresh install, and once `/setup` is completed the import refuses the non-empty database. To recover, stop the app, delete `pika-chat.db*` from the volume, and start again with your previous compose file.

The desktop app does not migrate local-mode data from v1.0.0-rc.1: local mode starts with a fresh database at `<userData>/local/pika-chat.db`, and the old data stays untouched in `<userData>/local/db/`.

---

## Android App

An Android app (APK, Android 7.0+) connects to one or more deployed Pika Chat servers. It follows the theme colour in the system bars, keeps the composer above the keyboard, supports the back button, and posts reply notifications. There is no on-device server; use a remote one.

- **Install**: download `Pika-Chat-<version>.apk` from [GitHub Releases](https://github.com/jason-zzx/pika-chat/releases) and open it; Android asks you to allow installs from your browser or file manager (unknown sources).
- **Servers**: the first launch opens the add-server form. Switch servers from the sidebar brand row, account menu, or sign-in page chip (a native picker). Each server keeps its own sign-in session.
- **Notifications**: Android 13+ asks for notification permission after the first connection. Android freezes backgrounded apps after about 10 seconds, so a notification appears only when a reply finishes while the app is open or just after you leave it; reopening the app shows the finished reply.
- **Updates**: the app checks GitHub Releases at launch and from Settings, and links to the new APK.
- **Requirements**: an up-to-date Android System WebView (update it in Google Play); the app shows an error asking for this otherwise.

Developing the Android app: see [`native/mobile/README.md`](native/mobile/README.md).

---

## Desktop App

A native desktop client (Electron) for Windows, macOS, and Linux runs Pika Chat locally on this computer with no server setup or connects to one or more remote Pika Chat servers, and adds a tray icon, a global show/hide hotkey, reply notifications, and auto-update.

- **Download** from the [GitHub Releases](https://github.com/jason-zzx/pika-chat/releases) page: Windows installer (`.exe`), macOS `.dmg` (Intel and Apple Silicon), Linux `.AppImage`, `.deb`, or `.rpm`.
- **Use locally ("This computer")**: choose "Use on this computer" on first launch to start a bundled local server (embedded SQLite database + Next standalone server) bound to `127.0.0.1` only. Conversations, uploaded files, credentials, and logs are stored locally under your OS app data directory (`<userData>/local/`) and survive app updates.
- **Connect to remote servers**: choose "Connect to a server" or switch anytime from the sidebar server switcher, account menu, or tray. Each server keeps its own sign-in session; switching between local and remote keeps both sides' data intact, and the local server stays running in the background until you quit.
- **Updates**: Windows and Linux update in-app. `.deb` / `.rpm` installs ask for your administrator password when you choose "Restart and install". On macOS the app shows a prompt linking to the new release.
- **Windows**: builds are unsigned; on the SmartScreen dialog choose "More info" → "Run anyway".
- **macOS**: builds are unsigned; after moving the app to Applications run `xattr -dr com.apple.quarantine "/Applications/Pika Chat.app"` once.
- **Linux**: GNOME needs the AppIndicator extension to show the tray icon. Without a tray, launching the app again or pressing the global hotkey (default `Ctrl+Shift+Space`) shows the window.

Developing the desktop app (separate pnpm workspace under `native/`):

```bash
DOCKER_BUILD=1 DATABASE_PATH=:memory: pnpm build
pnpm -C native install --frozen-lockfile
node native/desktop/scripts/build-server.mjs
pnpm -C native -r typecheck && pnpm -C native -r test
pnpm -C native/desktop start                          # run against local or remote servers
pnpm -C native/desktop dist --linux AppImage deb rpm  # local package build
```

---

## Configuration Reference

Configure Pika Chat through environment variables in your `.env` file or deployment container environment:

| Variable | Required | Default | Description |
|---|:---:|:---:|---|
| `DATABASE_PATH` | **Yes** | `/data/files/pika-chat.db` (Docker) | Path of the SQLite database file (`.data/pika-chat.db` in `.env.example` for local development, `:memory:` for throwaway runs). The compose files fix it to `/data/files/pika-chat.db` on the mounted volume. |
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
| `S3_DIRECT_ACCESS` | No | off | Set to `1` or `true` to enable direct browser S3 uploads (presigned POST) and downloads (presigned 302 GET), bypassing server transfer. `0`/`false`/unset disables. Requires `S3_BUCKET`. |
| `PIKA_IMAGE` | No | `ghcr.io/jason-zzx/pika-chat:latest` | Container image tag override in Docker Compose. |

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
- **Database & ORM**: [SQLite](https://www.sqlite.org/) ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)), [Drizzle ORM](https://orm.drizzle.team/)
- **Authentication**: [Better Auth](https://better-auth.com/) with TOTP Two-Factor Authentication
- **Content & Markdown**: [Streamdown](https://github.com/streamdown/streamdown), KaTeX, Mermaid, `@streamdown/cjk`, `@streamdown/math`, `@streamdown/mermaid`
- **Document Extractors**: `unpdf` (PDF), `mammoth` (DOCX), `xlsx` (Excel), `jszip` (EPUB/PPTX)
- **Object Storage**: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`
- **Internationalization**: [next-intl](https://next-intl.dev/)
- **Testing**: [Vitest](https://vitest.dev/), React Testing Library, `:memory:` SQLite integration test harness

---

## Development & Verification

Before submitting code, ensure all quality gates pass:

```bash
# Code style and linting
pnpm lint

# TypeScript static type check
pnpm typecheck

# Full unit and integration test suite
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
