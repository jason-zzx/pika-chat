# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Bundled RustFS Compose override (`docker-compose.prod.rustfs.yml`) for an all-in-one local S3 storage stack.
- GitHub Actions CI for continuous linting, typechecking, integration tests, and Docker build smoke testing.
- Multi-architecture container build workflow (`linux/amd64` and `linux/arm64`) with automated GitHub Releases.
