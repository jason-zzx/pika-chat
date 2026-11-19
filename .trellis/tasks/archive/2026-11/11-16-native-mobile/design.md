# Design — Android shell (remote mode)

Evidence for every platform claim below: `research/capacitor-android.md` (Capacitor 8.6.2 sources, androidx.webkit 1.18.0). Items marked UNVERIFIED there are confirmed on the emulator in step 2 of `implement.md` before building on them.

## Layout

```
native/
├── shell-ui/            # gains an optional `desktop` capability group in host.ts
├── desktop/             # preload-shell implements `desktop`
└── mobile/              # new workspace member
    ├── package.json     # @capacitor/core, @capacitor/android, @capacitor/cli (8.6.x), vite
    ├── capacitor.config.ts
    ├── index.html, src/main.ts   # sets window.pikaShell (Android host), then imports shell-ui app
    ├── vite.config.ts   # outDir dist (= Capacitor webDir), defines __APP_VERSION__ from root package.json
    └── android/         # committed Gradle project
        └── app/src/main/java/io/github/jasonzzx/pikachat/
            ├── MainActivity.kt   # BridgeActivity: registers PikaHostPlugin, bars, back, intents
            ├── PikaHostPlugin.kt # @CapacitorPlugin: pikaShell methods + shouldOverrideLoad
            ├── RemoteBridge.kt   # pikaNative + theme injection, message handling
            └── Updates.kt        # GitHub latest-release check + dialog
```

Kotlin files are split by responsibility only where they are large; small pieces stay inside `MainActivity.kt`. The implementer may merge files if they stay short.

## shell-ui contract change

`PikaShell` loses the desktop-only methods from its top level:

```ts
interface PikaShell {
  appVersion: string;
  listServers; saveServer; removeServer; checkServer; connect; checkForUpdates; // unchanged
  desktop?: {                       // present on desktop only
    openLocalLog(): Promise<void>;
    getLocalError(): Promise<string | null>;
    getHotkey(): Promise<string | null>;
    setHotkey(accelerator: string | null): Promise<{ ok: boolean }>;
  };
}
```

shell-ui uses `host.desktop` to decide:
- whether to show the local row and welcome screen, and handle `connect=local` / `failed=local`;
- whether to show the hotkey setting.

Without it:
- first launch with no servers opens the add form;
- an empty query auto-connects to the last server;
- local ids fall back to the list.

Desktop `preload-shell.ts` nests the four methods under `desktop`. No IPC changes.

## Android host (`native/mobile/src/main.ts`)

`window.pikaShell` is set, then `await import("@pika/shell-ui/app")`. shell-ui exports its entry module, so its CSS and boot code run unchanged.

| Method | Implementation |
|---|---|
| `listServers` / `saveServer` / `removeServer` / `connect` / `checkForUpdates` | `registerPlugin("PikaHost")` passthrough |
| `checkServer(url)` | `CapacitorHttp.get(`${url}/api/health`, 5 s)` → `classifyHealth` (shared TS); network error → `unreachable` |
| `appVersion` | `__APP_VERSION__` |

## PikaHostPlugin (native, owns state)

- **Storage:** server list `[{id, name, url}]` plus `lastServerId`, stored as one JSON string in `SharedPreferences("pika")`.
- **`saveServer`:**
  - re-normalizes the URL natively: http/https only, reduced to its origin;
  - names default to the host;
  - ids are `UUID`.
- **`removeServer`:**
  - expires every cookie `CookieManager.getCookie(origin)` returns;
  - `WebStorage.deleteOrigin(origin)`;
  - clears `lastServerId` if it pointed at the removed server.
- **`connect(id)`:** must run on the UI thread.
  1. Check `WebViewFeature.WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT`; reject if either is missing. shell-ui shows the native error string through a rejected promise; the list view renders the error.
  2. Remove the previous listener and script handlers, then register:
     - `pikaNativeHost` listener + document-start script with rules `{origin}`;
     - `pikaThemeHost` listener + script with rules `{origin, "https://localhost"}`.
     Re-registering embeds `serverName` as a JSON literal.
  3. Set `connected = server` and `lastServerId`, then `webView.loadUrl(origin)`.
- **`shouldOverrideLoad(uri)`:**
  - connected origin → `false` (load in WebView);
  - `https://localhost` → `null` (Capacitor default);
  - other http(s) → open `ACTION_VIEW`, return `true`;
  - everything else → `true`.
  This replaces Capacitor's static `allowNavigation`, which is fixed at startup.
- **Leaving a remote page:** when the shell (`https://localhost`) is shown again, `connected` stays set until the next `connect`. Notifications check it (see below).

## Injected scripts

- **`pikaNative` script** (rules `{origin}`, main frame only: the script returns early if `window !== top`):

  ```js
  window.pikaNative = Object.freeze({
    serverName: <literal>,
    notify: (i) => pikaNativeHost.postMessage(JSON.stringify({ type: "notify", ...i })),
    showServerMenu: () => pikaNativeHost.postMessage('{"type":"menu"}'),
    openServers: (s) => pikaNativeHost.postMessage(JSON.stringify({ type: "open", screen: s })),
  });
  ```

  The listener handles a message only if `sourceOrigin == connected.origin && isMainFrame`. Payloads are parsed with `org.json` and validated:
  - title ≤ 200, body ≤ 500;
  - path starts with `/` and is ≤ 2048;
  - screen ∈ {list, add}.
- **Theme script** (rules `{origin, https://localhost}`):
  - reads `meta[name=theme-color]` `content`, falling back to `getComputedStyle(document.body).backgroundColor` (WebView 133 serialises oklch tokens as `lab(...)`);
  - normalizes any CSS colour (`lab` / `oklch` / `rgb` / hex) to `#rrggbb` by painting a 1×1 canvas and reading `getImageData`;
  - posts `{color}`;
  - observes `meta[name=theme-color]` (`content` attribute), `document.documentElement` (`class` / `data-theme` mutations when `meta` is empty, e.g. unauthenticated pages or initial mount), and `prefers-color-scheme` changes.
  shell-ui needs no meta: the body background fallback covers it.

## System bars and keyboard

- `MainActivity.onCreate`:
  - call `registerPlugin(PikaHostPlugin::class.java)` before `super.onCreate`, then call `WindowCompat.enableEdgeToEdge(window)` and `window.isNavigationBarContrastEnforced = false` (API 29+) **after** `super.onCreate`, because `BridgeActivity.onCreate` resets the theme to `AppTheme_NoActionBar`;
  - set `android:theme="@style/AppTheme.NoActionBar"` on `<application>` in `AndroidManifest.xml` so no native action bar is shown.
- **Applying a colour** `c`:
  - `window.decorView.setBackgroundColor(c)`;
  - `bridge.webView.setBackgroundColor(c)`, so fractional-DPR slivers match;
  - `WindowCompat.getInsetsController(...)`: `isAppearanceLightStatusBars` / `isAppearanceLightNavigationBars` = luminance(c) > 0.5.
  - The last colour is remembered and re-applied after `super.onConfigurationChanged`, because Capacitor's SystemBars `setStyle` resets the decor background there.
  - A second `MainActivity` override is used only if needed.
- **Insets:** `insetsHandling: "native"`.
  - It differs from `"css"` only in not running `evaluateJavascript` on every page to set `--safe-area-inset-*` on `<html>` (that inline style caused a dev hydration mismatch on `<html>` and touched remote pages).
  - Padding vs passthrough is unchanged: WebView >= 140 with `viewport-fit=cover` (the web app and shell-ui set it) passes insets through to `env(safe-area-inset-*)`; older WebViews pad the decor view. In both, the IME is handled as decor bottom padding.
  - The pre-detection frame is avoided with `initialViewportFitValueHint: "cover"`.
  - If the emulator shows a hairline or ghost padding with this setup, the fallback is `insetsHandling: "disable"` plus our own decor `OnApplyWindowInsetsListener`: IME bottom padding, other insets passed through with `Insets.NONE`, never `CONSUMED`.

## Back

`onBackPressedDispatcher.addCallback`:
- on the connected origin, if the previous history entry's URL is on that origin → `goBack()`;
- on the connected origin otherwise → load `https://localhost/?list`;
- on shell-ui → disable the callback for this press and re-dispatch (default: background).

`@capacitor/app` is not installed, so nothing competes.

## Notifications

- **Channel:** `replies` (localized name), created on start.
- **Permission:** after the first successful remote page load (`onPageFinished` on the connected origin), request `POST_NOTIFICATIONS` once via the Activity Result API on API 33+. The "asked" flag is stored in prefs.
- **`notify`:**
  - `NotificationCompat` with the app icon, auto-cancel, and a unique id per notification;
  - `PendingIntent.getActivity(FLAG_IMMUTABLE | FLAG_UPDATE_CURRENT)` with extras `serverId` and `path`;
  - `launchMode="singleTask"`.
- **Tap:** `onNewIntent`: if `connected?.id == serverId`, `loadUrl(origin + path)`. Otherwise the tap only brings the app to front, the same as desktop.

## Downloads, errors, renderer

- **Downloads:** a `DownloadListener` and same-origin `window.open` of `/api/files/<id>`.
  - Capacitor's chrome client loads `_blank` in the same WebView, since multiple windows are not enabled.
  - Routing: `shouldOverrideLoad` on connected-origin `/api/files/<id>` (`target=_blank` / new tab) **opens** the file (`PikaHostPlugin.openAttachment`); the injected `download` message and the `DownloadListener` **download** (`downloadAttachment`). Both validate connected origin + `/api/files/<id>` first.
  - Download (`PikaHostPlugin.download`): on a background thread it sends `HEAD` (Next serves HEAD from the GET export) with the `CookieManager` cookie and no redirect following. 2xx: enqueue the URL with the cookie, filename from `Content-Disposition` (`filename*=UTF-8''` first, then `filename=`), mime from `Content-Type`. 3xx (S3 direct access): enqueue the absolute `Location` without the cookie, filename from its `response-content-disposition` query parameter. Other statuses and errors: "Download failed" toast. Saves to public Downloads with the system completion notification; an `ACTION_DOWNLOAD_COMPLETE` receiver (exported, ids we enqueued only) toasts "Downloaded <name>" or "Download failed" from the final status.
  - Open (`PikaHostPlugin.open`): GET with the cookie and no redirects, on 3xx a GET of `Location` without the cookie; non-2xx toasts failure. Saves to `cacheDir/open/<sanitized name>` (cleared on app start; the template `file_paths.xml` `cache-path` already covers it), then `Intent.createChooser(ACTION_VIEW + content Uri + READ grant, "Open with")`. `<queries>` for `VIEW content:*/*` is required, otherwise `resolveActivity` returns null on API 30+ and the "No app can open this file" toast fires wrongly. No `REQUEST_INSTALL_PACKAGES`, so an `.apk` is never installable from here.
  - The current page stays.
- **Errors:** main-frame load errors from Capacitor's `WebViewListener.onReceivedError` on the connected origin load `https://localhost/?failed=<id>`. ERR_ABORTED-equivalent cancellations are ignored.
- **Renderer:** `WebViewListener.onRenderProcessGone` returns `true` and calls `recreate()`. shell-ui then auto-connects to the last server.

## Updates

`Updates.kt`:
- GET `https://api.github.com/repos/jason-zzx/pika-chat/releases/latest` on a background thread (`HttpURLConnection`, `Accept: application/vnd.github+json`).
- If `tag_name != "v" + BuildConfig.VERSION_NAME`, show an `AlertDialog` with Download / Later. Download opens `html_url`.
- Silent at launch. Manual (`checkForUpdates` from shell-ui) also shows "up to date" or an error dialog, mirroring desktop `checkMac`.

## Build and versioning

- `android/app/build.gradle` reads root `package.json` with `JsonSlurper` (path `../../../../package.json`) to derive `versionName` and `versionCode` (M6).
- **Release `signingConfig`:**
  - uses env `ANDROID_KEYSTORE_PATH` and `ANDROID_KEYSTORE_PASSWORD` (PKCS12: the key password is the store password); the alias `pika-chat` is hardcoded;
  - applied only when `ANDROID_KEYSTORE_PATH` is set, so CI debug builds and local builds work without secrets.
- `minifyEnabled false` for the first release.
- Cleartext: `android:usesCleartextTraffic="true"`, because self-hosted servers on LAN http are a real use case. The desktop allows http too.
- **Icons:** adaptive launcher icon generated once from `public/icons/icon-maskable-512.png` and committed (no generator dependency kept). The notification small icon is a monochrome vector.
- **Local toolchain**, outside the repo:
  - Temurin JDK 21 (Fedora 44 has none, and Gradle 8.14 cannot run on 25);
  - cmdline-tools in `~/Android/Sdk` (platform-tools, `platforms;android-36`, `build-tools;36.0.0`, emulator, `system-images;android-36;google_apis;x86_64`).
- **Release** (`release.yml` `build-android`, needs `quality-gate`):
  - checkout, pnpm, node;
  - `setup-java` 21 temurin, `gradle/actions/setup-gradle`;
  - verify the tag matches `package.json`;
  - `pnpm -C native install`, `pnpm -C native/mobile build`, `cap sync android`;
  - decode the keystore secret to `$RUNNER_TEMP`;
  - `./gradlew assembleRelease`;
  - rename to `Pika-Chat-<version>.apk` and upload the artifact.
  `create-release` adds `build-android` to `needs` and attaches it.
- **CI** (`ci.yml`): an `android` job does the same without secrets, running `assembleDebug`.

## Web change

`SidebarUserMenu`: `switchShortcut` is `null` on Android (`navigator.userAgent.includes("Android")`), and `DropdownMenuShortcut` renders only when it is set. Test added beside the existing native tests.

## Trade-offs

- Hand-written native code (~400–600 Kotlin lines) is unavoidable with either Capacitor or a plain WebView. Capacitor still saves the file chooser, permissions, the shell-ui bridge and build plumbing (M1).
- Single cookie jar: per-origin isolation is natural. Two saved entries with the same origin share a session (acceptable; desktop partitions by id).
- Theme sync depends on WebView ≥ 140 passthrough for the cleanest result. Older WebViews fall back to SystemBars padding mode with the decor background painted in our colour, so bars still match.

## Rollback

Additive:
- delete `native/mobile`, the `build-android` / `android` jobs and the web shortcut tweak;
- revert the `desktop?` grouping in `host.ts` and `preload-shell.ts`.

## Deviations found during emulator acceptance

- **Removing a server does not clear web storage.** `WebStorage.deleteOrigin` is a no-op on WebView 133 (localStorage survived); only cookies are expired. No per-origin clear exists in the public API.
- **`RemoteBridge.clearNative` only drops the accepted origin.** Unregistering `pikaNativeHost` on server removal (with no new listener added afterwards) was followed by native SIGSEGVs in WebView 133 on the next page load. `installForServer` removes the old listener only right before adding the new one, guarded by `nativeScript != null`. After removal, the injection for the old origin lingers until the next `connect`, but the listener rejects every message because `connectedOrigin` is null.
- **Insets on WebView < 140**: the emulator (WebView 133) runs SystemBars padding mode (`env(safe-area-inset-*)` = 0); status/navigation bars show the decor background painted by `applyBarColor`. Passthrough mode (>= 140) is not tested on an emulator.
- **Dev testing** uses `adb reverse` + `http://localhost:3000` (Next dev blocks `10.0.2.2` chunks), not `10.0.2.2` as in implement.md.

- Launch splash: Capacitor's template `splash.png` drawables and the `android:background` item in `AppTheme.NoActionBarLaunch` were removed; API 31+ shows the system splash with the app icon.
- **Download anchors:** a click on `<a download href="/api/files/<id>">` is not reported to `shouldOverrideLoad` or the `DownloadListener`; WebView follows the 302 to the presigned storage URL, which then hits `shouldOverrideLoad` and goes to the system browser. The injected `pikaNative` script now captures such clicks (connected origin only), `preventDefault()`s and posts `{type:"download", url}`; native re-validates through `PikaHostPlugin.downloadAttachment` (connected origin, `/api/files/<id>`), the same check `shouldOverrideLoad` and the `DownloadListener` use.
- **shell-ui bar colour:** the theme script sent the colour at `DOMContentLoaded`, but shell-ui's stylesheet comes from a dynamic import and was not applied yet (transparent body, nothing sent), so bars kept the remote's colour on shell-ui. It now also sends on `load`.
