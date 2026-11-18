# Design — Native desktop & mobile apps

Cross-child architecture and contracts. Each child refines its part in its own `design.md`.

## Layout

```
native/
├── shell-ui/        # shared static web module: server list, add/edit server, connect errors
├── desktop/         # Electron main/preload, electron-builder config
│   └── server/      # (desktop-local) launcher for bundled Next standalone + PGlite
└── mobile/          # Capacitor project (android/), capacitor.config.ts
```

`native/` is its own pnpm workspace (`native/pnpm-workspace.yaml`, own lockfile) containing `shell-ui`, `desktop`, and later `mobile`; the root workspace and Dockerfile are untouched.
Root `tsconfig.json` / eslint / `.dockerignore` exclude `native/`.

## Runtime model

```
Shell starts → shell-ui (bundled, local file)
  ├─ pick remote server URL ─→ GET {url}/api/health → navigate webview to {url}
  └─ pick "Local" (desktop)  ─→ start bundled server on 127.0.0.1:{port} → navigate to it
```

- Remote content is loaded as a top-level navigation, so better-auth cookies are first-party; no CORS or `trustedOrigins` change for remote mode.
- Desktop session isolation: one Electron `session.fromPartition("persist:server-<id>")` per server entry.
  Android: single WebView cookie jar; switching servers keeps cookies per origin (different origins are naturally isolated).
- Navigation outside the server origin opens the system browser.

## Contracts

### Health / version (server change, owned by desktop-remote)

`GET /api/health` → `{ ok: true, version: "X.Y.Z" }` (version from `package.json`).
Shell compares major.minor with its own version; mismatch → non-blocking warning banner in shell-ui before navigating.

### Native bridge (web change, owned by desktop-remote; Android implements it in mobile)

The shell exposes `window.pikaNative` (Electron: `contextBridge` in preload; Android: injected script backed by Capacitor `LocalNotifications`):

```ts
interface PikaNative {
  platform: "desktop" | "android";
  notify(input: { title: string; body: string; topicPath: string }): void;
}
```

Web side (chat-pool finish → `ChatPoolBridge`): when the page is hidden or unfocused and the turn was not
aborted/disconnected, call `window.pikaNative?.notify(...)`. No Web Notification fallback for browser/PWA
(decided in `11-16-native-desktop-remote`). Clicking the notification focuses the window and opens the topic path.
The global type lives in `src/global.d.ts`; no other web code reads `pikaNative`.

### Local mode (server change, owned by desktop-local)

Activated by env `LOCAL_MODE=1`, set only by the desktop launcher. Gated at process level like `DEMO_MODE`.

- DB: `DATABASE_URL` absent; `PGLITE_DATA_DIR` selects `drizzle-orm/pglite` in `src/server/db/client.ts`; migrations via `drizzle-orm/pglite/migrator` at launcher startup.
- Secrets: launcher generates `BETTER_AUTH_SECRET` / `CREDENTIAL_ENCRYPTION_SECRET` once, stores them with Electron `safeStorage` in the app data dir, passes them as env.
- Auth: local super admin auto-provisioned; a launcher-only endpoint or one-time token signs the shell in; `/setup` and login routes redirect to `/`; 2FA / registration / user-management UI hidden.
- Storage: local disk under the app data dir.
- Fallback: if the PGlite spike fails, use `embedded-postgres` and keep the postgres-js driver (`research/local-db-options.md`).

## Release

- `release.yml` gains native build jobs (desktop matrix on `ubuntu`/`windows`/`macos`; later Android via Gradle with a release keystore from a repo secret); `create-release` waits for them and attaches their artifacts, so one tag yields one release.
- Updates: electron-updater with GitHub provider on Win/Linux; macOS and Android query the latest GitHub release and show a download prompt.

## Trade-offs

- Server-origin loading means the shell needs a reachable server to render anything except shell-ui; accepted (D1, R1).
- Electron + Capacitor = two shells; mitigated by shared `shell-ui` and the small `pikaNative` surface.
- PGlite single connection serializes DB work in local mode; acceptable for one user, verified by the spike.

## Rollback

Each child is additive: removing `native/`, the `pikaNative` call, the health `version` field, or `LOCAL_MODE` paths restores current behavior.
