# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-25

### Highlights

- **Cross-Platform Desktop App (Windows, macOS & Linux)**: Native Electron client supporting both zero-config standalone local mode ("This computer") and multi-server remote connections with isolated sessions. Includes a theme-synced frameless titlebar (`hiddenInset` on macOS) and inset sidebar, custom themed server switcher popover, system tray, global show/hide hotkey, OS reply notifications, in-app updates (Windows/Linux; release prompt on macOS), interactive Windows NSIS installer and portable `.zip`, plus Linux `.AppImage`, `.deb`, and `.rpm` packages.
- **Android App (APK)**: Native Capacitor 8 client for connecting to deployed Pika Chat servers, featuring origin-scoped native bridge security, live theme-colored system bars and server switcher dialog, keyboard-aware layout, predictive back navigation, attachment upload/download, and a `shortService` foreground keep-alive so reply notifications arrive reliably when backgrounded during streaming.
- **Single Embedded SQLite Database (`better-sqlite3`) & Automatic PostgreSQL Import**: Replaced PostgreSQL (Docker) and PGlite with embedded SQLite configured via `DATABASE_PATH` (defaulting to `/data/files/pika-chat.db` in Docker and `<userData>/local/pika-chat.db` on Desktop), eliminating the separate database container. Existing `v0.4.0`–`v0.4.2` PostgreSQL instances automatically import into SQLite in a verified read-only snapshot on first boot when keeping their previous Compose configuration.
- **Temporary Chat**: Start ephemeral conversations from the chat header (**Temporary**) with full multi-turn replies, stop/resume, versions, attachments, and context compression while staying URL-less and excluded from sidebar history, favorites, topic counts, search, and auto-titling—automatically deleted on navigation, reset, page unload, sign-out, native exit/server close, or after 24 hours idle.
- **Message Text Quoting & Jump-to-Source**: Select text in any user or assistant message body to attach a removable **Quote** card to the composer (passed to the model as `<quote>` context while keeping your message intact), and click any quote card to center and flash-highlight the exact source passage.
- **Paginated Sidebar Topics & Persistent Composer Drafts**: Assistant topic lists now load favorites in full and regular topics in 20-item infinite-scroll pages with compact relative timestamps, hover-overlay actions, and touch long-press menus; unsent composer text is saved per topic and assistant draft in `localStorage` (showing a **Draft** indicator) and expires after 14 days, auth resets, or server switches.
- **Native-Like App Navigation & Installable PWA**: Added logical stack navigation with overlay-first Back dismissal across Web, Desktop (mouse/trackpad/keyboard Back and lossless return-to-server switching), and Android (dual-WebView shell), paired with an installable Web App Manifest, safe-area support, dynamic `theme-color` tracking, touch pinch-zoom and double-tap image preview, and mobile Enter-to-newline input ergonomics.

### Feats

- **Desktop Storage Manager, Preferences & Diagnostics**: Added desktop controls in **Settings → General** (close-to-tray vs. quit on Windows/Linux, global shortcut recorder, and reply notification toggle), a 4-category client **Storage** manager with safe cache and log cleanup (preserving login sessions and local SQLite data), and a 5-click version trigger for on-demand `developerMode` diagnostics (detached DevTools and desktop logs).
- **Pre-First-Paint Shell Theme Sync & Unified Update Entry**: Extracted shared CSS color tokens (`theme-tokens.css`) so `shell-ui` mirrors the last connected server's light/dark mode and preset before first paint, disabled automatic update checks at launch, and consolidated manual **Check for updates** into a unified `shell-ui` footer (also available in **Settings → About** on desktop).
- **Settings → About & Client Version**: Added `/settings/about` displaying version info, Local/Demo mode badges, one-click **Copy version**, project links, and MIT License details, alongside `window.pikaNative.appVersion` reporting for connected Desktop and Android clients.
- **Batch Upstream Model Sync**: Upgraded provider model discovery ("Fetch from upstream") into a two-tab comparison dialog (**Available** and **Not returned**) with **Keep all** / **Uncheck all** batch controls, empty-upstream warnings, and atomic server sync.
- **Mobile Typography & Header Quick Action**: Increased mobile Markdown prose sizing (`16px`) and touch-friendly list spacing across sidebars, menus, and sheets, and added a mobile-only **New topic** icon button in the chat header on regular existing topics.
- **Consistent Dialogs & Confirmations**: Standardized external link prompts (including search result links), admin password resets, search provider deletions, manual context compression confirmations, and `shell-ui` server removal onto themed `Dialog` / `AlertDialog` flows.
- **Server Health Version Check**: Extended `GET /api/health` to report the server version for native client compatibility checks.

### Fixes

- **Chat Reconnect & Native Reply Notifications**: Allowed discovery refreshes to retry failed reconnects after clearing transcript errors, and ensured native reply notifications fire on regenerations and user message edits (staying silent on manual aborts and broken streams) while checking cached topic metadata first.
- **Windows Minimize/Restore Rendering & Crash Recovery**: Prevented white screens after minimizing/restoring from the Windows taskbar, added renderer and GPU crash auto-recovery, and added rotated `desktop.log` logging with append-mode `local/server.log` truncation.
- **Desktop & Linux Packaging**: Added multi-size PNG icons (`16x16`–`512x512`) so Linux `.rpm`, `.deb`, and `.AppImage` packages install standard `hicolor` icon sizes, and fixed Windows standalone symlink unwrapping and retry handling.
- **Mobile Composer Toolbar**: Kept the composer bottom toolbar on a single horizontally scrollable row on mobile, moved the expand toggle to the textarea corner, and hid **Chat map** and **Compress context** buttons on empty topics.
- **Overlays, Sidebar & Search UI**: Fixed `DropdownMenuContent` portal z-index stacking and nested dialog backdrops (`forceRender`), fixed touch long-press topic menu title clamping, aligned collapsed sidebar icons across chat and settings, unified tooltip styling and hover highlights, synced `SearchDialog` hover/keyboard selection with an inline clear button, prevented `FilesList` checkbox layout jumps, and avoided RSC redirect errors on `/settings`.
- **Update SemVer Comparison**: Fixed SemVer pre-release comparison in Android and macOS update checks.

### Dev

- **SQLite Test Suite & Simplified CI**: Switched Vitest integration tests to per-worker `:memory:` SQLite, removed PostgreSQL/PGlite CI services and Dockerfile C++ build tools, and split multi-arch Docker release builds onto native `amd64` and `arm64` runners merged via `imagetools`.
- **Native Workspace & Release Pipeline**: Added the isolated `native/` pnpm workspace (`@pika/shell-ui`, `pika-chat-desktop`, `@pika/mobile`) with unit and type checks, automated multi-OS Electron builds (plus a manual `desktop-smoke` workflow) and signed Android APK builds, and kept prerelease tags off Docker `latest`.
- **API & TypeScript Cleanup**: Replaced deprecated framework and schema APIs and resolved TypeScript warnings across the codebase.

### Chore

- **Compose File Consolidation**: Renamed `docker-compose.standalone.yml` to `docker-compose.yml` and `docker-compose.full.yml` to `docker-compose.rustfs.yml` (removing the PostgreSQL service and `docker-compose.dev.yml`).
- **Brand Standardization & Documentation**: Standardized the product spelling to **Pika Chat** across localizations, icons, and auth settings, and updated `README.md` / `README.zh-CN.md` with SQLite migration, Desktop, and Android documentation.
- **Dependency Upgrades**: Updated root and native workspace dependencies (including Next.js 16.4, React 19.3, Better Auth 1.7.28, Electron 45.5, AI SDK, Streamdown, and Vitest 5).

## [0.4.2] - 2026-11-16

### Fixes

- **Markdown Controls & External Link Dialog**: Localized Streamdown's code block, table, image, and Mermaid controls, and routed message-body link prompts through the app's animated, localized `ExternalLinkDialog`.
- **Dialog Footers & Action Buttons**: Flattened `AlertDialogFooter` to match standard dialogs and moved inline form submit buttons (user creation, provider setup, and search provider keys) into `DialogFooter` at a consistent size.
- **Drag-Selected Message Copy**: Drag-selecting past the end of a message no longer appends trailing blank lines when copying.

## [0.4.1] - 2026-11-16

### Fixes

- **Topic Titles**: New topics are now named in parallel with the first reply, and the sidebar picks up the generated title as soon as it is ready instead of showing the default title until you navigate away.
- **Title & Translation Prompts**: Title generation and message translation no longer answer the message itself on models that weaken or ignore system prompts. Reasoning models get a larger output budget and longer timeout for titles, so they stop falling back to the truncated message.

### Chore

- **Shared Provider Labels**: Shared provider groups in the model picker are now labeled "(shared)" without the sharer's name.

## [0.4.0] - 2026-11-15

### Highlights

- **Server-Managed Generation**: Once the server accepts a send, regenerate, or edit, the reply no longer depends on the browser staying open. Switching topics, refreshing, closing the tab, or signing out keeps the generation running on the server; coming back resumes the same reply with its live status and Stop button instead of calling the model again. Explicit Stop or deleting the topic/assistant still cancels it.
- **Per-Message Token Stats**: Each assistant reply now shows input/output tokens and output speed; hover or tap for cache-hit tokens, hit rate, time to first token, and total duration.

### Feats

- **Background Generation & Recovery**:
  - Text and image turns run as server-side tasks that survive client disconnects; closing the tab no longer severs the upstream provider (this replaces the 0.3.3 disconnect-on-cancel behavior).
  - Returning to a topic shows the final result if finished, or restores accumulated text, reasoning, tool state, citations, and live streaming if still running. Topic titles are generated even with no browser attached.
  - Duplicate submits and reconnects never re-run the same generation; a lost submit acknowledgement can be recovered by request ID. One active turn per topic is enforced server-side, while different topics generate in parallel.
  - Partial output is checkpointed periodically. After a server restart, running tasks are marked interrupted with their saved content (never silently re-run), stopping tasks finish as stopped, and queued tasks continue.
  - Subscribe, query, and stop all verify account ownership; signing out ends client subscriptions and clears account-local state, and signing back in resumes the task.
  - No new deployment components: works on the existing Node + PostgreSQL setup with no extra configuration.
- **Message Usage Stats**:
  - Usage is captured per model call, so TPS excludes TTFT and client-side tool execution; mobile shows TPS only in the inline row.
  - OpenAI-compatible cache hits are read from raw usage (`cached_tokens`, `prompt_cache_hit_tokens`); providers that don't report cache hide the cache rows instead of showing 0.

### Fixes

- **Model Vendor Icons**: Models hosted by another lab's catalog provider (e.g. Claude on Azure or Vertex, DeepSeek on Alibaba) now get their own vendor icon instead of the host's; existing catalog rows are backfilled.
- **Reconnect Loop**: The chat no longer keeps retrying reconnects the server has refused.

### Dev

- Upgraded `ai` to 7.0.170 and `@ai-sdk/react` to 4.0.174 for mid-stream resume support.
- Pruned redundant generation tests and added a shared integration harness.

## [0.3.3] - 2026-10-21

### Highlights

- **Replies Keep Streaming While You Browse Away**: Switching topics mid-reply no longer shows an empty view that suddenly fills in later — the stream keeps running in the background, and returning to the topic resubscribes to the still-accumulating reply with its live streaming indicator. Topics streaming in the background are marked with a spinner in the sidebar.

### Feats

- **Background Stream Resume**:
  - A session-level chat pool keeps one live connection per topic: navigating away no longer abandons the in-flight reply, and navigating back shows the accumulated text and live status instantly instead of waiting for a history refetch.
  - Streams that finish in the background are persisted and pre-fetched, so the finished turn is already there on your next visit — no flash of a stale or empty conversation.
  - The sidebar shows a spinning indicator on any topic with an active background stream (send or regenerate).
- **Provider Disconnect on Client Cancel**: Refreshing the page or closing the tab now immediately severs the upstream provider connection instead of letting the server finish (and bill) a stream nobody can read. Partial replies are still persisted before disconnect, exactly as before.
- **Streaming Render Performance**: High-frequency stream chunks are coalesced into ~20fps updates and message rows are memoized, so chatty providers can no longer force a full message-list re-render (and markdown re-parse) per chunk.

## [0.3.2] - 2026-10-20

### Highlights

- **Edit User Messages In Place & Regenerate**: Sent user messages can now be edited directly in the message list — text and attachments included. Sending the edit creates a new switchable version of the user message and automatically regenerates the assistant reply below it as another switchable version.

### Feats

- **User Message Editing**:
  - User messages gain a pencil icon action and an "Edit" dropdown menu item (tap-reveal path on mobile, no hover dependency); assistant messages are unaffected.
  - In-place editor prefills the current version's text, shows the current version's attachment chips (removable, with new uploads reusing the composer's upload/validation/quota pipeline), and offers Cancel/Send; Cancel exits with zero server writes.
  - Sending an edit never mutates the original: the edited content is written as a **new version in the same version group** (transactional `is_selected` switch), and the version switcher now appears on user messages too.
  - The edit then auto-triggers a regeneration using the composer's **currently selected** model/assistant/search mode/reasoning effort (identical to the regenerate button); the new assistant reply joins the existing reply's version group (or opens a new slot), with immediate thinking-shimmer feedback. Later messages are never truncated.
  - Server side: the existing regenerate endpoint accepts an optional `edit` payload; edited attachments pass `resolveOwnedFileParts` ownership validation before the new version is persisted, so failed streams keep the user edit and record a failed assistant version (same semantics as regenerate).
  - Compressed-region messages cannot be edited, and editing is disabled while any stream is in flight; content-free sends (no text and no attachments) are blocked exactly like the composer.
- **Per-Route Document Titles**: Settings, auth, and assistant pages now set distinct browser tab titles via route metadata, and the chat view keeps the tab title in sync with the active topic title.

### Fixes

- **Message Group Position Stability**: Group display order is now anchored by a new immutable `group_created_at` column instead of a version's own `created_at` — deleting a group's earliest version no longer shifts the group in the list, and regenerating an emptied slot lands back at its original position instead of jumping to the topic's end.
- **Group Row Remount on Version Delete**: Deleting a non-final version no longer unmounts and remounts the message group row, preserving active UI state.
- **Scrollbar Drag vs. Scroll Follow**: Pressing the scrollbar (drag or track click) now releases the streaming scroll-follow pin, so the view is no longer yanked back to the bottom mid-drag by async content growth.

## [0.3.1] - 2026-10-11

### Fixes

- **Environment Variable Tolerance**: Optional env vars (`S3_BUCKET`, `S3_ENDPOINT`, `FILE_STORAGE_DIR`, `FILE_UPLOAD_MAX_MB`, etc.) now treat an empty assignment (`VAR=`) as unset instead of crashing boot-time validation, and `S3_DIRECT_ACCESS` accepts `0`/`false` as explicit off alongside unset. Misspelled values still fail fast at startup.

## [0.3.0] - 2026-10-07

### Highlights

- **In-Chat Image Generation & Editing**: Select an image-output model and generate images directly in chat — OpenAI-compatible `/images/generations` & `/images/edits`, Gemini native `generateContent`, and Seedream multi-reference fusion are all adapted. Attach reference images for img2img editing via the one-tap "Edit this image" shortcut.
- **Global Search Command Palette**: Press `Ctrl+K` / `Cmd+K` anywhere to search topic titles and full message text in a centered modal with full keyboard navigation, highlighted matches, scroll-to-message deep links, and in-topic next/previous hit navigation.
- **User-Level Default Models**: New `/settings/models` page pins dedicated default models for chat, title generation, context compression, and translation, with silent fallback when a preferred model becomes unavailable.

### Feats

- **In-Chat Image Generation**:
  - Models whose `outputModalities` include `image` (catalog-populated or manually overridden) are treated as image models and carry a recognizable badge in model pickers.
  - Dedicated non-streaming generation bypass: `openai-compatible` → `POST /images/generations`; `google` → `generateContent` with `responseModalities`; `claude` is rejected with an explicit error.
  - Static per-family capability table drives size/resolution tiers, image count, and quality options; vendor 400 errors are surfaced verbatim to the user.
  - Generated images persist as regular file attachments (reusing storage, quota, and ownership pipelines) and render inline as assistant message file parts.
  - Supports regenerate (new version via the version-group mechanism) and mid-generation abort with stopped-state marking.
  - Generated images are named with the model and timestamp; copy and translate actions are hidden on generated-image messages.
- **Image Editing (img2img)**:
  - Attach reference images in image mode, or use the "Edit this image" shortcut on generated-image thumbnails and in the preview dialog to load the image as a referenced attachment without re-uploading.
  - Adapters: Gemini prepends `inlineData` parts; OpenAI-compatible routes by family capability to multipart `/images/edits` or the Seedream-style `image` parameter on `/images/generations`.
  - Server-side graded validation runs before topic creation: `image.attachmentUnsupported`, `image.tooManyReferences`, and `image.referenceNotImage`.
- **In-Page Image Preview**: Shared preview dialog with zoom, pan, and previous/next navigation across message images.
- **User-Level Default Model Preferences**:
  - New `/settings/models` settings page with four slots — chat, title, compression, translation — backed by `users.model_preferences` (JSONB) and `GET/PATCH /api/account/model-preferences` with availability validation on save.
  - Chat model resolution chain: topic's last-message model → assistant default → user chat default; preferred models that are deleted or disabled silently fall back to existing behavior.
  - Title generation, translation, and both manual and automatic compression honor their respective preference slots.
- **Global Search**:
  - Sidebar full-text search over topic titles and message text (Postgres `ILIKE` over extracted text parts, selected versions only, ownership-scoped, match-window snippets).
  - Command palette modal via `Ctrl+K` / `Cmd+K` or the sidebar search entry: grouped results, ↑/↓ + Enter keyboard navigation, and `<mark>` match highlighting themed by the active preset's `--primary`.
  - Message-hit deep links (`?m=<groupId>`) scroll to and flash-highlight the target message before stripping the parameter; a floating `k / n` control navigates between same-topic hits without reopening the palette.
- **Attachment Thumbnails**: Server-generated thumbnails for image rows in the file management list.

### Fixes

- **Message Ordering Under Clock Skew**: Unified all `chat_messages.created_at` timestamps onto the Node application clock (`appendUserMessage` now accepts an explicit `createdAt` captured early in the request), eliminating inverted user/assistant ordering when the Postgres container clock drifts from the app clock.

### Dev

- **Database Migration**: Committed migration `0023_petite_liz_osborn.sql` (`users.model_preferences`).

### Chore

- Refreshed README feature descriptions and added UI screenshots.

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
