# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-17

### Highlights

- **Context History Compression**: Automatically compress long chat dialogues into rolling summaries when exceeding 80% of the model context budget, with manual compression in Composer, collapsible summary views, and compressed-zone safety locks.
- **On-Demand Message Translation**: One-shot AI translation for any question or answer into 8 target languages with per-version persistent JSONB caching, native language labels, and preserved citation source mapping.
- **Curated Theme Presets & Preference Persistence**: 6 new theme presets (Paper, Graphite, Ocean, Forest, Rose, Violet) with light and dark palettes, SSR `<html data-theme>` injection to eliminate hydration flash, and database-backed persistence in user account preferences.
- **Provider Enable/Disable & Model Search**: Instant toggle to enable or disable provider configurations across the instance, along with real-time substring search and selection locks in the model discovery dialog.
- **Compact URL Identifiers**: Replaced 36-character UUIDv7 strings with compact `agt_` / `tpc_` Base62 IDs for cleaner address bar navigation while preserving backward compatibility.

### Feats

- **Chat History Compression**:
  - Auto-triggering: Automatically summarizes early selected-version history and injects it into system instructions when estimated tokens exceed 80% of the model's context window.
  - Manual trigger: Added a "Compress context" icon button (`ListCollapseIcon`) in the Composer with in-flight shimmering progress status in the message list.
  - Collapsible summary marker: Rendered an interactive boundary divider in the message list that smoothly expands to reveal the persisted Markdown summary body (collapsed by default).
  - Version-group boundary tracking: Anchored compression boundaries to version groups (`summary_up_to_group_id`), ensuring branch version switching never duplicates history or drops the marker.
  - Compressed region safety lock: Protected summarized turns by hiding delete and regenerate actions, backed by server-side 409 Conflict (`message.compressedLocked`) enforcement.
  - Regenerate alignment: Reuses the persisted summary on non-tail message regenerations without triggering redundant summarization calls.
- **On-Demand Message Translation**:
  - 8 target languages: Native support for Simplified Chinese, English, Japanese, Korean, French, German, Spanish, and Russian.
  - Per-version persistent caching: Stored translations in `chat_messages.translations` (JSONB, per-language key merge) for instant reload and zero redundant model calls.
  - Collapsible translation cards: Rendered collapsible translation blocks beneath messages, forwarding citation source maps so `[n]` references resolve to interactive source chips.
  - Responsive state feedback: Added thinking-shimmer placeholder feedback while translation is in flight.
- **Preset Themes & Appearance Persistence**:
  - Added 6 curated preset themes with dedicated light/dark CSS token blocks (`data-theme`).
  - Polished default neutral theme with enhanced border warmth and smoothed dark surface gradients.
  - Persisted user theme mode and preset in `users.theme_mode` and `users.theme_preset`, server-rendered on each request.
  - Added visual swatch-card preset picker to `/settings/general` and updated sidebar quick toggle.
  - Enforced full token coverage via `scripts/check-theme-tokens.mjs` (`pnpm check:themes`).
- **Provider & Model Governance**:
  - Added `provider_configs.enabled` toggle; disabled providers are automatically hidden from model pickers and blocked at service authorization boundaries.
  - Added instant substring filtering and selection locking for already-configured models in `DiscoverModelsDialog`.
- **Prefixed Short IDs**:
  - Minted assistants as `agt_` and topics as `tpc_` followed by 12 Base62 characters (~71 bits) using `insertWithShortId` with unique-collision retry protection.
- **Search Freshness & Date Anchoring**:
  - Passed provider-reported publication dates (`publishedDate` from Exa/Tavily) into model context and displayed them on search tool cards.

### Fixes

- **Multi-Source Citation Grouping**: Corrected remark parsing and renderer logic so grouped citations (e.g. `[3, 5]`, `[1、2]`, `[2，4]`) render as discrete clickable chips rather than unparsed literal brackets.
- **Date-Anchored Model Instructions**: Injected client IANA timezone and current calendar date into system instructions via `buildChatInstructions`, eliminating knowledge cutoff drift on time-sensitive queries.
- **Composer Accessibility**: Uniformly equipped all Composer action icon buttons with aligned `aria-label` and `title` attributes.

### Dev

- **Shared UI Primitives**: Extracted `CollapseBlock` for reusable accessible accordion containers and `shimmer.ts` for unified text shimmer gradient animations.
- **Centralized Model Availability Gate**: Replaced duplicated resolution checks with `requireModelForActor` across chat, regenerate, and compression routes.
- **Database Migrations**: Committed migrations `0021_good_luke_cage.sql` (`chat_messages.translations`) and `0022_aberrant_mercury.sql` (`topics.summary_text`, `topics.summary_up_to_message_id`).

### Chore

- Added official MIT license (`LICENSE`).

## [0.1.1] - 2026-09-15

### Highlights

- **Reverse Proxy & Multi-Origin Deployment Readiness**: Replaced internal `BETTER_AUTH_URL` with standard `APP_URL`, added `APP_TRUSTED_ORIGINS` for multi-address access, and enabled reverse proxy header trust, resolving 403 `INVALID_ORIGIN` issues on 2FA enrollment.
- **Flexible Docker Compose Deployment**: Restructured Compose stacks into standalone, full, and dev modes with discrete PostgreSQL variables support and parameterized configuration.

### Feats

- **Standardized Application URL & Multi-Origin Trust**:
  - Replaced `BETTER_AUTH_URL` with `APP_URL` across environment schemas, compose templates, and documentation.
  - Added `APP_TRUSTED_ORIGINS` to support comma-separated trusted origins for LAN, reverse proxy, and multi-domain setups.
  - Enabled `advanced.trustedProxyHeaders: true` in Better Auth to correctly infer protocol and host behind reverse proxies (Nginx, Caddy, Traefik).
  - Removed hardcoded local LAN IP from Better Auth trusted origins.
- **Discrete PostgreSQL Configuration**: Supported discrete connection variables (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) with automatic URL encoding alongside `DATABASE_URL`.

### Fixes

- **Resolved 403 `INVALID_ORIGIN` on Two-Factor Authentication**: Eliminated origin mismatches when enrolling or managing 2FA behind reverse proxies or on remote/LAN IP deployments.
- **Compose Parameterization**: Added project namespaces and parameterized Compose variables to prevent container name collisions.
- **Flaky Seed Message Timestamps**: Fixed clock skew test flake in seed turns by leveraging PostgreSQL `defaultNow()`.

### Dev

- **CI & Release Workflows**: Added automated GitHub Actions test and release workflows with multi-arch Docker image builds.
- **Node 24 Upgrade**: Upgraded CI runners and build actions to Node 24 and fixed Dockerfile buildx warnings.

## [0.1.0] - 2026-09-14

### Highlights

- **Initial Release of Pika Chat**: A self-hosted, privacy-first multimodal AI chat workspace with zero-maintenance defaults.
- **Universal Multi-Provider Support**: Connect OpenAI, Anthropic (Claude), Google Gemini, Ollama, OpenRouter, DeepSeek, or any OpenAI-compatible API endpoint with authenticated AES-256-GCM credential encryption at rest.
- **Full Multimodal Attachment Pipeline**: Upload images, documents (PDF, Word, Excel, PowerPoint, EPUB, Text, Markdown), audio, and video with instant text extraction and dynamic model conversion.
- **Real-Time Web Search with Citations**: Tool-based function calling web search with multi-provider fallbacks (Brave, Tavily, Exa, Firecrawl), deep page scraping, and request-scoped citations.
- **Pluggable Zero-Config Storage**: Local disk storage by default, automatic S3 bucket creation on first use, optional direct client-to-S3 byte transfer (`S3_DIRECT_ACCESS`), and bundled RustFS Compose stack.
- **Enterprise-Grade Auth & Governance**: Better Auth authentication, TOTP Two-Factor Authentication (2FA), role-based permissions (Super Admin, Admin, Member), storage quotas, and first-run `/setup` wizard.
- **Complete Bilingual i18n**: Full localization for English and Simplified Chinese (简体中文).

### Feats

- **Advanced Chat Interface**:
  - Non-tail assistant message regeneration with branching message versions (`group_id` / server-persisted `is_selected`).
  - Smooth streaming scroll follow with tail message reserve space to eliminate viewport jump jitter.
  - Rich Markdown parsing via Streamdown: KaTeX math formulas, interactive Mermaid diagrams, syntax-highlighted code blocks with one-click copy, and CJK-friendly typography.
  - Mobile-first touch optimization: tap-to-reveal action menus and non-modal selects.
  - Assistants and topics organization: customize system instructions, pin favorite topics, and export dialogues.
- **AI Model Orchestration**:
  - Automatic model capability discovery via `/v1/models` endpoint.
  - Per-model configurable context tokens, reasoning effort (thinking), input modalities, and custom vendor icons.
  - Private user credentials alongside instance-wide shared provider configurations.
- **Attachment & Document Engine**:
  - Upload-time text extraction for PDF, DOCX, XLSX, PPTX, EPUB, TXT, and Markdown with control character sanitization.
  - Dynamic model replay: native multimodal payloads for vision/audio models; cached text extraction fallback for text-only models.
  - Official Gemini and Anthropic Files API integrations with expiration tracking and lazy re-upload handling.
- **Storage & Quota Management**:
  - Automatic bucket bootstrapping on S3-compatible object stores (AWS S3, MinIO, Cloudflare R2, RustFS).
  - Direct S3 access with presigned POST upload policies and 302 presigned GET redirects.
  - Global default storage quota (5 GiB) and customizable per-user quotas with automatic orphan file sweeps.
- **Security & Administration**:
  - AES-256-GCM authenticated credential encryption for stored provider API keys.
  - Guided setup wizard at `/setup` for safe initial Super Admin creation.
  - Instance governance controls: toggle open/closed registration, manage users, and enforce role hierarchy.

### Fixes

- Filtered leaked `<tool_call>` markup in streaming holding transforms.
- Ensured CJK punctuation compatibility for Markdown emphasis delimiters via `remark-cjk-friendly`.
- Resolved attachment validation before creating user messages to prevent orphaned, topic-wedging messages on upload failure.
- Sanitized NUL bytes (`0x00`) from PDF text extraction to avoid PostgreSQL UTF-8 text column errors.

### Dev

- Comprehensive test suite with Vitest and PostgreSQL integration tests across 130 test files and 1,000+ test cases.
- Production Docker container with Next.js standalone output and automated database migration on container boot.
- Production Docker Compose configurations: all-in-one stack (`docker-compose.full.yml`), standalone app (`docker-compose.standalone.yml`), and local dev (`docker-compose.dev.yml`).
- GitHub Actions CI for continuous linting, typechecking, integration tests, and Docker build smoke testing.
- Multi-architecture container build workflow (`linux/amd64` and `linux/arm64`) with automated GitHub Releases.
