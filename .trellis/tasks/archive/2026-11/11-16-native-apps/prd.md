# Native desktop & mobile apps

## Goal

Ship Pika Chat as installable apps without rewriting the web UI:

- **Desktop (Electron)**: connect to a deployed Pika server (remote mode) or run a bundled Pika server on the local machine (local mode, "直接使用").
- **Android (Capacitor)**: connect to a deployed Pika server only.
- **PWA**: installable web app; the only path for iOS users and the lowest-cost path on any mobile.

## Decisions (user)

| ID | Decision |
|---|---|
| D1 | Mobile is remote-mode only; no on-device server. |
| D2 | Local mode does no data sync with any remote server. |
| D3 | Native shell code lives in this repo under `native/`. |
| D4 | Electron for desktop, Capacitor for mobile (`research/mobile-shell-options.md`). |
| D5 | No Apple Developer account. All artifacts ship via GitHub Releases, no app stores: Windows (unsigned) + Linux with electron-updater auto-update; macOS unsigned dmg with documented quarantine removal and "new version available" prompt instead of auto-update; Android APK sideload; iOS = PWA only. |
| D6 | Local mode binds `127.0.0.1` on a random port, auto-creates a local super admin on first launch and signs in directly (no `/setup`, no login page); 2FA, registration toggle, and user management hidden. |
| D7 | First-release native feature set — see table below. Share-target, deep links, and remote push deferred. |

### First-release native features (D7)

| Feature | Desktop | Android |
|---|---|---|
| Server list with per-server session isolation | ✅ | ✅ |
| External links open in system browser | ✅ | ✅ |
| Update check (Win/Linux auto-update; macOS & Android prompt to download) | ✅ | ✅ |
| Window position/size memory | ✅ | — |
| Tray icon, close-to-tray | ✅ | — |
| Global hotkey to show window | ✅ | — |
| System notification on generation completion while the app is alive in background | ✅ | ✅ |
| Soft keyboard fit, hardware back button, status bar color | — | ✅ |

## Repo Facts

- Pages under `src/app/(app)` are RSC that read session cookies and query the DB server-side; data APIs live under `src/app/api/*`; the only Server Action is `src/i18n/actions.ts`. → The shell must load a running Pika server origin; a bundled static UI would require a rewrite.
- DB: postgres-js + drizzle in `src/server/db/client.ts`; migrations run by `scripts/migrate.ts` before `server.js` (`Dockerfile:21,46`). SQL uses `ilike`, jsonb `->>`, `SELECT ... FOR UPDATE`; no extensions (`research/local-db-options.md`).
- `output: "standalone"` only when `DOCKER_BUILD=1` (`next.config.ts`).
- better-auth cookie sessions; `trustedOrigins` = `localhost:3000` + `APP_URL` origin + configured extras (`src/server/auth/index.ts:103`).
- Required env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET` (`src/server/env.ts`).
- `/api/health` returns `{ ok: true }` only (`src/server/services/health.service.ts`).
- No web manifest, `viewportFit`, `appleWebApp`, safe-area handling, or `public/` dir.
- Client stream completion surfaces in `src/components/chat/chat-pool.ts:186` (`onFinish`) — the hook point for completion notifications. Android WebView has no Web Notification API, so Android needs a native notification bridge.
- Generation is server-owned background work with resume (`.trellis/spec/backend/chat-generation-lifecycle.md`), so a suspended app loses nothing.
- Process-level mode gating precedent: `DEMO_MODE` (`.trellis/spec/backend/demo-mode.md`).

## Child Tasks

| Child | Deliverable | Depends on |
|---|---|---|
| `11-16-native-pwa` | Installable PWA incl. iOS safe-area/keyboard | — |
| `11-16-native-desktop-remote` | Electron shell, remote mode, D7 desktop features | — |
| `11-16-native-desktop-local` | Local mode inside Electron shell (D6) | desktop-remote |
| `11-16-native-mobile` | Capacitor Android shell, D7 Android features | desktop-remote (shared shell UI, notification bridge contract) |

## Cross-Child Requirements

- R1 Shell loads the server origin as a top-level page in the webview (first-party cookies); no cross-origin API client.
- R2 `native/` is excluded from root `tsconfig`, eslint, and Docker build context.
- R3 `/api/health` reports the server version; shells warn when server and shell major.minor differ.
- R4 One `vX.Y.Z` tag produces the Docker image and all native artifacts; release notes come from `CHANGELOG.md`, with `CHANGELOG.zh-CN.md` updated alongside.
- R5 Web behavior is unchanged when not running inside a shell and local-mode env is unset.

## Out of Scope

- On-device server on mobile; iOS native app.
- App Store / Play Store / TestFlight distribution; code signing and notarization.
- Data sync between instances; LAN/remote access to a local-mode instance.
- Share-target, `pika://` deep links, remote push (needs a publisher-run push relay because FCM keys cannot be distributed to self-hosted servers).
- Rewriting the UI as a static/client-only app.

## Acceptance Criteria (cross-child)

- [ ] All four children archived with their own acceptance criteria met.
- [ ] A release tag builds the Docker image plus Windows, macOS, Linux installers and the Android APK, attached to one GitHub Release; existing CI stays green.
- [ ] Running the web app in a normal browser with no local-mode env behaves exactly as before.
