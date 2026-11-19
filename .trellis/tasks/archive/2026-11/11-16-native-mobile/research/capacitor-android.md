# Research: Capacitor Android shell for Pika Chat

- **Query**: Capacitor Android shell that bundles `native/shell-ui`, navigates to a runtime-chosen server origin, exposes only `window.pikaNative` to that origin, follows `theme-color` live on status + nav bar; plus back button, notifications, CORS, release CI, Linux dev, Capacitor vs. plain Kotlin.
- **Scope**: mixed (Capacitor source read from npm tarballs, androidx.webkit 1.18.0 sources, developer.android.com / source.android.com, capacitor-docs repo; plus repo files)
- **Date**: 2026-11-18

Method note: Capacitor behaviour below comes from the **actual Java sources** of `@capacitor/android@8.6.2` (npm tarball) unless marked otherwise. File:line cites refer to that package (`capacitor/src/main/java/com/getcapacitor/...`).

## Relevant repo files

| File | Why it matters |
|---|---|
| `src/global.d.ts` | `PikaNative` contract: `serverName`, `notify({title,body,path})`, `showServerMenu({x,y})`, `openServers("list"\|"add")` |
| `native/shell-ui/src/host.ts` | `PikaShell` contract shell-ui expects (`listServers`, `saveServer`, `checkServer`, `connect`, …, plus desktop-only `getHotkey`/`openLocalLog`) |
| `native/desktop/src/main.ts:172-186,318-319` | Desktop policy to mirror: off-origin `will-navigate`/`window.open` -> external browser; `fromRemote` = sender webContents + `senderFrame.origin === server.url` |
| `src/components/layout/use-theme-sync.ts:24-28` | Writes `getComputedStyle(document.body).backgroundColor` into `<meta name="theme-color">` |
| `src/app/layout.tsx:43-44` | Viewport already has `viewportFit: "cover"`, `interactiveWidget: "resizes-content"` |
| `src/app/globals.css:55,91,180,...` | `--background` values are **`oklch(...)`** (see caveat in section 4) |
| `src/components/layout/AppShell.tsx:44`, `ui/sidebar.tsx`, `ui/toast.tsx` | Use `env(safe-area-inset-*)` directly (not Capacitor's `--safe-area-inset-*` vars) |
| `src/components/chat/chat-pool.ts:170-200` | Generations are durable server-side (`streamId` = generation id, reconnect URL); relevant to background behaviour |

---

## 1. Versions (as of 2026-11-18)

npm dist-tags (registry.npmjs.org, fetched today):

| Package | latest | notes |
|---|---|---|
| `@capacitor/core` / `android` / `cli` | **8.6.2** (2026-11-12) | `next` = **9.0.0-rc.0** (2026-11-12); `latest-7` = 7.6.10 |
| `@capacitor/local-notifications` | 8.3.1 | peer `@capacitor/core >=8.0.0`; Kotlin |
| `@capacitor/status-bar` | 8.0.4 | |
| `@capacitor/keyboard` | 8.0.6 | |
| `@capacitor/app` | 8.1.2 | |
| `@capacitor/preferences` | 8.0.1 | |
| `@capacitor/browser` | 8.0.5 | |
| SystemBars | — | **core plugin inside `@capacitor/android` since 8.0** (no npm package); always registered (`Bridge.java:664`) |

**Capacitor 8 (stable) toolchain** — from CLI android template + `capacitor/build.gradle` + `updating/8-0.md`:
- minSdk **24**, compileSdk **36**, targetSdk **36**
- AGP **8.13.0**, Gradle wrapper **8.14.3**, Java source/target **21** (so JDK 21 needed to build), Kotlin 2.2.20 if Kotlin used
- Node **>= 22** (`@capacitor/cli` `engines`), Android Studio Otter 2025.2.1+ (only if using AS)
- androidx: activity 1.11.0, appcompat 1.7.1, core 1.17.0, webkit 1.14.0, coordinatorlayout 1.3.0, core-splashscreen 1.2.0; **Cordova framework 14.0.1 is always bundled** in 8.x
- Template `MainActivity extends BridgeActivity {}`; manifest has `launchMode="singleTask"`, `configChanges` incl. `uiMode`, only `INTERNET` permission.

**Capacitor 9 (RC, not stable yet)** — `updating/9-0.md` on capacitor-docs `main`:
- minSdk **26**, compileSdk/targetSdk **37**, AGP **9.4.1**, Gradle **9.8.2**, Node **>= 24**, Android Studio 2026.1.4+
- Cordova layer only included when a Cordova plugin is installed; R8 on by default for release; deprecated Java APIs removed.
- Note: capacitor-docs `main` already documents v9 (environment-setup says Node 24 and "latest stable Android 17 (API 37)").

Latest androidx (Google Maven, today): webkit **1.18.0** (1.19.0-alpha01), core **1.19.1**, activity 1.14.0-alpha03 listed as latest.

Plugin need assessment (facts, see later sections for why):
- `local-notifications`: JS-facing only; tap event is delivered to JS listeners (`LocalNotificationsPlugin.kt:53-60`). The remote page has no Capacitor bridge, so `pikaNative.notify` + tap handling must be native code regardless.
- `status-bar`: `backgroundColor`/`overlaysWebView` **no effect for targetSdk 36 on Android 16** (its README "Android 16+ behavior change"); on Android 15 only with `windowOptOutEdgeToEdgeEnforcement`. Only style (icon light/dark) still works — SystemBars core already does that.
- `keyboard`: not needed for resize; SystemBars core already pads for IME (section 4).
- `app`: back-button handling only (section 5); its default behaviour doesn't fit.
- `preferences`: usable by shell-ui for the server list (shell-ui runs on the bridge origin).
- `browser`: Custom Tabs for external links; `Intent.ACTION_VIEW` (what Capacitor already does in `launchIntent`) is sufficient for "open in system browser".

## 2. How Capacitor Android decides which page gets the bridge

Init order (`Bridge.java:195-233`): `initWebView()` -> `setAllowedOriginRules()` -> `new MessageHandler(...)` -> register plugins -> `loadWebView()`.

**Origins computed once at construction**
- `setAllowedOriginRules()` (`Bridge.java:236-255`): `allowedOriginRules` = `{scheme://hostname}` (default **`https://localhost`**; `CapConfig.java:38-39`) + `server.url` if set + each `server.allowNavigation` entry (prefixed `https://` if no scheme). `appAllowNavigationMask = HostMask.parse(allowNavigation)`.

**Two injection pieces**
1. **Bridge JS** (`Bridge.java:265-276`): if `WebViewFeature.DOCUMENT_START_SCRIPT` is supported, `WebViewCompat.addDocumentStartJavaScript(webView, bridgeJs, singleton(origin of appUrl))` — i.e. only the app origin (`https://localhost`, or `server.url` origin). Fallback when unsupported: `JSInjector` splices the script into HTML served by `WebViewLocalServer` — local assets, or proxied GETs (`handleProxyRequest`, `WebViewLocalServer.java:515-560`) for hosts registered in `authorities` (local host, `server.url` authority, allowNavigation entries). Unknown hosts don't match `uriMatcher` -> `shouldInterceptRequest` returns null -> no injection.
2. **Native endpoint** `androidBridge` (`MessageHandler.java:26-42`): `WebViewCompat.addWebMessageListener(webView, "androidBridge", bridge.getAllowedOriginRules(), listener)`; listener rejects `!isMainFrame`. **Fallback**: if `WEB_MESSAGE_LISTENER` unsupported, if adding throws, or if `android.useLegacyBridge: true` -> `webView.addJavascriptInterface(this, "androidBridge")`, which is exposed to **every origin and frame**. A page can call plugins by posting raw JSON (`{type, pluginId, methodName, options, callbackId}`) without the bridge JS.
   - Native->JS responses go through the `JavaScriptReplyProxy` of the sending document (`MessageHandler.java:~125`), or `evaluateJavascript("window.Capacitor.fromNative(...)")` in legacy mode.
   - Default `android.minWebViewVersion` = 60, hard minimum 55 (`Bridge.java:105-106`).

**Navigation policy**
- `BridgeWebViewClient.shouldOverrideUrlLoading` -> `bridge.launchIntent(url)` (`Bridge.java:389-425`):
  1. URLs whose path starts with `/_capacitor_http_interceptor_` are always blocked;
  2. each plugin's `Plugin.shouldOverrideLoad(Uri)` is asked — **non-null return wins** (`true` = block, `false` = allow; `Plugin.java:1006-1014`);
  3. `data:`/`blob:` are allowed;
  4. if host+scheme != appUrl's and host doesn't match `allowNavigation` mask -> `startActivity(new Intent(ACTION_VIEW, url))` (system browser / app chooser) and block.
- Per Android docs, `shouldOverrideUrlLoading` is **not** called for app-initiated `loadUrl()` or POST requests. It **is** called for JS-initiated navigations (`location.href = ...`), link taps, and HTTP redirects ([WebViewClient reference](https://developer.android.com/reference/android/webkit/WebViewClient)).
- Consequences for a runtime origin:
  - native `webView.loadUrl(serverOrigin)` succeeds without allowNavigation;
  - shell-ui doing `location.href = serverOrigin` -> opened in the external browser;
  - **every later full navigation or redirect on the remote site** (sign-in redirects, `location.assign`, `target=_blank` links — `setSupportMultipleWindows` is not set so they load in place) goes through `launchIntent` and is sent to the external browser, unless a plugin's `shouldOverrideLoad` returns `false` for the connected origin.
  - Next.js client routing (pushState) never hits this callback.

**Runtime changeability**
- `allowNavigation` / `allowedOriginRules` / `appAllowNavigationMask` are built once; there is no public setter (`getAllowedOriginRules()` returns the live `HashSet`, but the `addWebMessageListener` and `addDocumentStartJavaScript` calls already copied it — see `WebViewCompat.java:773-781` `toArray`).
- Extension points that do work at runtime:
  - a custom `Plugin` overriding `shouldOverrideLoad(Uri)` that reads the current server origin (registered via `registerPlugin` in `MainActivity.onCreate` before `super.onCreate`);
  - `bridge.setWebViewClient(BridgeWebViewClient subclass)` (`Bridge.java:1468-1471`);
  - `bridge.addWebViewListener(WebViewListener)` for `onPageStarted/onPageLoaded/onPageCommitVisible/onReceivedError/onReceivedHttpError/onRenderProcessGone`;
  - `bridge.getWebView()` for direct `WebViewCompat` calls.
- `onPageStarted` calls `bridge.reset()`, which removes **all plugin JS listeners** on every navigation (`Bridge.java:576-581`, `BridgeWebViewClient.java:62-64`).

**Answer: is the bridge injected into a remote page navigated to at runtime?**
- **No**, as long as the remote origin is not `server.url` / `allowNavigation` **and** the WebView supports `WEB_MESSAGE_LISTENER` (and `useLegacyBridge` is false): it gets neither the bridge JS nor `androidBridge`.
- On WebViews without that feature, Capacitor falls back to `addJavascriptInterface`, which is reachable from the remote page.
- Separately, some core plugins run `evaluateJavascript` on whatever page is current, e.g. SystemBars injects `--safe-area-inset-*` CSS vars (harmless).

## 3. Exposing `pikaNative` to exactly one runtime origin

androidx.webkit 1.18.0 (`WebViewCompat.java`, `ScriptHandler.java`):
- `addWebMessageListener(webView, jsObjectName, Set<String> allowedOriginRules, WebMessageListener)` — the object is injected "in any frame whose origin matches … **for every navigation after this call**", available at document start. Rules: `scheme://host[:port]`, `https://*.example.com`, IP literals, `custom-scheme://`, or `*`. Docs warn that **http origins expose the object to network attackers**.
- `removeWebMessageListener(webView, name)` — the object stays in the current JS context, but messages no longer arrive. **Rules cannot be edited**; to change origin: remove, then add again with the new set (takes effect on the next navigation). Must be called on the UI thread.
- `WebMessageListener.onPostMessage(view, message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply)` — `sourceOrigin` = origin of the posting frame (`"null"` for file:/content:); `isMainFrame` distinguishes iframes. Reply via `replyProxy.postMessage(String|byte[])`; the page must post first for native to get a proxy.
- `addDocumentStartJavaScript(webView, script, rules)` returns `ScriptHandler`; `remove()` "will take effect from next page load". The script runs before page JS, **blocks loading** (keep short), and only in frames that start loading after the call. The listener's object is injected before such scripts, so the script can wrap it (e.g. define `window.pikaNative = { serverName: "<literal>", notify(...) {...postMessage(JSON)} }`). Re-adding per connection lets you embed `serverName` as a literal.
- Feature flags: `WebViewFeature.WEB_MESSAGE_LISTENER`, `DOCUMENT_START_SCRIPT` (check `isFeatureSupported`). Newer variants `JS_INJECTION_IN_FRAME_AND_WORLD` exist (isolated worlds). Minimum WebView versions for the two base features: **UNVERIFIED** (not stated in the sources; commonly cited as roughly M83 / M87). Practically, Play-updated WebViews today are M14x-M15x (Capacitor's SystemBars comments mention testing on 148-156).

**Why not `@JavascriptInterface`**
- `addJavascriptInterface` injects into **all frames of all origins** for the WebView's lifetime.
- It gives no caller origin or frame; methods run on a binder background thread, so checking `webView.getUrl()` is racy.
- It is Capacitor's own legacy fallback.
- `addWebMessageListener` gives per-origin injection plus `sourceOrigin` and `isMainFrame` for a second check — the analogue of desktop's `senderFrame.origin === server.url`.

**Coexistence with Capacitor**: works side by side. Capacitor's `androidBridge` is keyed on its own name/rules; a second listener (e.g. `pikaNativeHost`) with `{connectedOrigin}` and a second document-start script are independent. Both are plain `WebViewCompat` calls on `bridge.getWebView()`.

## 4. Edge-to-edge, live bar colour, insets, keyboard

**Platform facts**
- Android 15 + targetSdk 35: edge-to-edge enforced.
  - `setStatusBarColor`/`statusBarColor` deprecated with **no effect**.
  - `setNavigationBarColor` has no effect for gesture nav; for 3-button nav it is deprecated but still applies, with an **80% opaque contrast scrim** because `navigationBarContrastEnforced` defaults to true.
  - `setDecorFitsSystemWindows` and `navigationBarDividerColor` are deprecated and disabled.
  - Source: [Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15).
- Android 16 + targetSdk 36: `windowOptOutEdgeToEdgeEnforcement` is disabled ([Android 16 behavior changes](https://developer.android.com/about/versions/16/behavior-changes-16)).
- On older OS versions the app is edge-to-edge only if it calls `WindowCompat.enableEdgeToEdge(window)` (androidx.core; bars transparent, 3-button nav gets a scrim). For a transparent 3-button bar, set `window.isNavigationBarContrastEnforced = false` (API 29+) ([edge-to-edge guide](https://developer.android.com/develop/ui/views/layout/edge-to-edge)).
- Recommended way to colour behind the bars:
  - draw app content behind them: for a WebView, set window/decor background and `webView.setBackgroundColor(color)`, with the page painting its own background under `viewport-fit=cover`;
  - set icon contrast via `WindowCompat.getInsetsController(window, decor).isAppearanceLightStatusBars/NavigationBars`.
- **Capacitor 8 does not call `enableEdgeToEdge`** (no reference in `@capacitor/android` sources). Behaviour therefore differs: edge-to-edge on Android 15+ devices, not edge-to-edge (bars painted with theme colours) on API 24-34.

**WebView insets** ([Understand window insets in WebView](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)):
- M136: `systemBars()`/`displayCutout()` reach CSS `safe-area-inset-*`, fullscreen WebViews only.
- M139: IME insets resize the **visual viewport**.
- M144: safe areas work for all WebViews.
- The WebView gets non-zero insets only where system UI overlaps its bounds.
- To mark insets handled natively, zero them with `WindowInsetsCompat.Builder.setInsets(type, Insets.NONE)`, not `CONSUMED` — consuming causes "ghost padding" after the keyboard hides.
- Older WebViews return 0 for `env(safe-area-inset-*)` ([crbug 40699457](https://issues.chromium.org/issues/40699457)).

**Capacitor 8 SystemBars core plugin** (`plugin/SystemBars.java`; docs [system-bars](https://capacitorjs.com/docs/apis/system-bars)):
- `android.adjustMarginsForEdgeToEdge` (Capacitor 7) was **removed in 8**, replaced by SystemBars (`updating/8-0.md`).
- Config `SystemBars.insetsHandling`: `css` (default) | `native` | `disable`; plus `initialViewportFitValueHint`, `style`, `hidden`.
- It sets an `OnApplyWindowInsetsListener` on the **decorView**:
  - **Passthrough** (WebView major >= 140 and page has `viewport-fit=cover`): decor padding is 0, or `ime.bottom` while the keyboard is visible. Insets pass to the WebView, with the bottom system inset reduced by the IME height. The page uses `env()`.
  - **Padding mode** (WebView < 140, or `viewport-fit=cover` not yet detected): decorView padded by the system-bar insets, insets zeroed. The bar areas then show the **decorView background**.
  - `viewport-fit` is detected after `onPageCommitVisible` via `evaluateJavascript`. Until then `initialViewportFitValueHint` decides (default: padding mode), so a one-frame layout jump is possible.
  - With `css` it also runs `evaluateJavascript` to set `--safe-area-inset-*` on the current page (any origin). The px value is cast with `(int)`, which **truncates** fractional CSS px.
  - `setStyle()` toggles light/dark icons and **resets `decorView.setBackgroundColor(theme windowBackground)`**. It runs on init and on every `handleOnConfigurationChanged` (e.g. night-mode change, since the manifest lists `uiMode` in `configChanges`). That can overwrite a live colour set by app code unless it is re-applied afterwards (or `insetsHandling: "disable"` is used and insets are handled in app code).
  - The IME is handled as decor bottom padding unless `softInputMode` is `adjustNothing`.

**Keyboard**
- `SOFT_INPUT_ADJUST_RESIZE` is deprecated in favour of handling `WindowInsetsCompat.Type.ime()`.
- With edge-to-edge, the window is no longer resized for you; the inset listener must pad or resize. SystemBars does this. In passthrough mode it pads by `ime.bottom`, so the WebView's layout viewport shrinks and a bottom-anchored composer stays visible.
- Whether WebView honours `interactive-widget=resizes-content` (the app sets it) is **UNVERIFIED**. Capacitor's comment says WebView ignores `overlays-content`.

**Live colour from the page**
- `theme-color` is written from `getComputedStyle(body).backgroundColor`. The theme defines `--background` as `oklch(...)`, so Chromium will likely serialise the computed value as `oklch(L C H)`, not `rgb()` (**UNVERIFIED on device**).
- Neither `android.graphics.Color.parseColor` nor Capacitor's `WebColor.parseColor` (hex only) parses oklch, so the colour has to be normalised to sRGB before native use. Options: in the injected script via a 1x1 canvas `fillStyle` -> `getImageData`, or with an oklch->sRGB conversion natively.
- Observing changes: a `MutationObserver` on `meta[name=theme-color]` (`content` attribute) in the injected script that posts to the listener.

**"Hairline gap at the bottom" — root causes found**
1. **Device-pixel rounding at fractional DPR** (e.g. 2.625, 2.75): inset px / DPR and `100dvh`-style heights snap to device pixels, leaving a 1-device-px row the page doesn't paint. That row shows the **WebView background (default white)** or the decor background. Usual mitigation: paint `webView.setBackgroundColor` **and** window/decor background with the same live colour as the page, so leftover slivers match.
2. **SystemBars padding mode / pre-detection frame**: bar areas show the theme `windowBackground` rather than the page colour, either until `viewport-fit=cover` is detected or permanently on WebView < 140. The decor colour is then reset on config change (above).
3. **3-button navigation contrast scrim** (`navigationBarContrastEnforced` default true): a translucent strip different from the page colour.
4. **Truncated `--safe-area-inset-*`** from SystemBars `css` mode: `(int)` cast can be up to 1 CSS px short. Not used by this app (it uses `env()`), but relevant if those vars are adopted.
5. Pre-Android-15 devices not in edge-to-edge: the system paints the nav bar with theme colours (`navigationBarColor`, possible divider line via `navigationBarDividerColor` on API 28+). The default divider for AppCompat DayNight themes is **UNVERIFIED**.
6. Consumed insets / ghost padding after IME hide (above).

## 5. Hardware back

- `BridgeActivity` registers no back handling of its own (grep of sources). Default Activity behaviour applies: root launcher activity -> task moved to back.
- `@capacitor/app` (`AppPlugin.java:45-62`) registers an androidx `OnBackPressedCallback`:
  - with no JS `backButton` listener: `if (canGoBack) goBack()` — **otherwise it swallows the press**;
  - with a listener: emits `backButton {canGoBack}` to JS.
- Because `bridge.reset()` drops JS listeners on every navigation and the remote page has no bridge, a shell-ui JS listener **does not survive** navigation to the server. Back policy for remote pages must be native.
- Option: our own `OnBackPressedCallback` (androidx.activity; required anyway for targetSdk 36 on Android 16, where `onBackPressed`/`KEYCODE_BACK` aren't delivered under predictive back). It can inspect `webView.copyBackForwardList()` to `goBack()` while the previous entry is on the connected origin, else load shell-ui. pushState entries from Next.js routing appear in the WebView back/forward list (**UNVERIFIED wording, standard WebView behaviour**).
- If using the App plugin, `disableBackButtonHandler: true` (plugin config) or `App.toggleBackButtonHandler` stops it competing.

## 6. Notifications and background behaviour

**Permission and posting**
- Android 13+ requires runtime `POST_NOTIFICATIONS` (targetSdk >= 33), plus a `NotificationChannel` (API 26+).
- `@capacitor/local-notifications` 8.3.1:
  - adds `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `SCHEDULE_EXACT_ALARM`, 3 receivers and a FileProvider to the manifest;
  - tap -> `PendingIntent.getActivity` with `ACTION_MAIN/CATEGORY_LAUNCHER`, `SINGLE_TOP|CLEAR_TOP` and notification extras (`LocalNotificationManager.kt:246,286-298`);
  - `handleOnNewIntent` emits retained `localNotificationActionPerformed` to **JS listeners**.
  - So "tap -> navigate the remote page to `path`" still needs native code (or a shell-ui listener; but shell-ui is not loaded while connected).
- Plain `NotificationCompat`:
  - channel + `NotificationManagerCompat.notify` + `PendingIntent.getActivity(..., FLAG_IMMUTABLE)` with a `path` extra;
  - with `launchMode="singleTask"`, the tap arrives in `onNewIntent` -> `webView.loadUrl(origin + path)` after checking the server is still connected (desktop does the same check, `main.ts:325-328`);
  - permission via `ActivityResultContracts.RequestPermission`.

**Background streaming (what is realistic)**
- Capacitor keeps JS timers running on pause (`KeepRunning` default true -> `MockCordovaWebViewImpl.handlePause` doesn't pause timers) and does not call `webView.onPause()`.
- The limiting factor is the OS. On Android 14+ the **cached apps freezer** freezes processes **10 s after entering the cached state** (no visible activity, no foreground service); all threads stop until unfrozen by a lifecycle event ([AOSP cached apps freezer](https://source.android.com/docs/core/perf/cached-apps-freezer)). The freezer exists since Android 11 with OEM-dependent enablement.
- Expect the SSE/fetch stream and JS to stall a few seconds after backgrounding. A completion notification fires only if generation ends within that window, or while a foreground service keeps the process un-cached. Foreground services from WebView-only apps have type and policy limits; details not researched.
- That the WebView sandboxed renderer is frozen together with the app is **UNVERIFIED**.
- Server side: generations are durable (`chat-pool.ts` `generationId` / reconnect URL), so on return the client reconnects and shows the result. This matches the PRD wording "completion notification appears while the app is alive".
- Renderer kills while backgrounded: Capacitor's `onRenderProcessGone` returns the listener result, default false -> **app process is killed**. A `WebViewListener.onRenderProcessGone` returning true plus reload avoids that.

## 7. CORS for shell-ui health checks

- shell-ui origin is `https://localhost` (defaults `server.androidScheme="https"`, `hostname="localhost"`). WebView `fetch("https://server/api/health")` is cross-origin and needs `Access-Control-Allow-Origin` from the server.
- `CapacitorHttp` (core, always registered):
  - `enabled: true` patches `fetch`/XHR globally to native HTTP on bridge pages;
  - with `enabled: false` (default), calling `CapacitorHttp.get/request` explicitly from `@capacitor/core` still works natively (`CapacitorHttp.java:85-96`; `enabled` gates only patching and the `/_capacitor_http_interceptor_` proxy).
  - Either way, no CORS.
- Cleartext http servers need `android:usesCleartextTraffic="true"` or a network-security-config. Android blocks cleartext by default since API 28; Capacitor's `server.cleartext` documents this.
- Native alternative: `HttpURLConnection` in a custom plugin/handler.

## 8. Release build in GitHub Actions

- Current actions: `actions/setup-java@v6` (v6.3.0), `android-actions/setup-android@v4` (v4.0.4), `gradle/actions@v6` (setup-gradle, v6.4.1), `actions/checkout@v7`, `actions/setup-node@v7`. The repo already uses checkout/setup-node v7.
- `ubuntu-latest` (24.04) image already has the Android SDK at `/usr/local/lib/android/sdk`:
  - platforms android-34..37.2, build-tools 34-37, cmdline-tools 12.0, platform-tools 37.0.1;
  - JDK 8/11/**17 (default)**/21/25 via `JAVA_HOME_21_X64` ([runner image readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)).
  - JDK 21 must be selected (setup-java `java-version: 21` or `JAVA_HOME=$JAVA_HOME_21_X64`); setup-android is optional.
- Signing pattern:
  - store the keystore as a base64 secret and decode to a file in the job;
  - `signingConfigs { release { storeFile file(System.getenv("ANDROID_KEYSTORE_PATH")); storePassword System.getenv(...); keyAlias ...; keyPassword ... } }`, referenced from `buildTypes.release`;
  - `./gradlew assembleRelease` -> `app/build/outputs/apk/release/app-release.apk`.
  - Alternative: `npx cap build android --keystorepath --keystorepass --keystorealias --keystorealiaspass --androidreleasetype APK [--signing-type apksigner|jarsigner]` (CLI 8.6.2 flags). It runs `assembleRelease` and then `apksigner`.
- `versionName` from the tag string; `versionCode` must be a monotonically increasing int, commonly `major*10000 + minor*100 + patch` (convention, not a requirement).
- Build time and APK size baseline: **UNVERIFIED** (no SDK available locally to measure).
  - Expect a few minutes cold, dominated by the Gradle distribution plus dependency download (setup-gradle caching helps).
  - Capacitor 8 always bundles the Cordova framework, so an unminified Capacitor APK is larger than a bare WebView app. Measure with the first CI build.

## 9. Local dev on Fedora without Android Studio

Checked on this machine: Fedora 44, `/dev/kvm` present, `java` = OpenJDK 25 runtime only (no `javac`), no adb/sdkmanager.

**JDK**
- Fedora 44 repos offer only `java-25-openjdk-devel` and `java-latest-openjdk-devel` (27). **No java-21 package.**
- Gradle compatibility: running Gradle on Java 25 requires **Gradle >= 9.1**, so Capacitor 8's Gradle 8.14.3 cannot run on JDK 25 ([Gradle compatibility](https://docs.gradle.org/current/userguide/compatibility.html)). Capacitor 9's Gradle 9.8.2 can.
- With Capacitor 8 on Fedora 44, get JDK 21 elsewhere: Adoptium Temurin RPM repo or tarball, or SDKMAN, and point `JAVA_HOME` at it.

**SDK and device**
- SDK without Android Studio:
  - download `commandlinetools-linux-16111833_latest.zip` (cmdline-tools 23.0 = latest; dl.google.com repository2-3.xml) and unzip to `$ANDROID_HOME/cmdline-tools/latest/`;
  - `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"` (37.x also available), plus `"emulator" "system-images;android-36;google_apis;x86_64"` for an emulator;
  - `avdmanager create avd ...`, then `emulator -avd <name>` (KVM accel via `/dev/kvm`).
- adb: `dnf install android-tools` (1:37.0.0p1 in Fedora 44 updates) or SDK platform-tools.
- Phone: enable USB debugging (or Wireless debugging `adb pair`/`adb connect`).
- Build loop: `npx cap sync android && (cd android && ./gradlew assembleDebug) && adb install -r app/build/outputs/apk/debug/app-debug.apk`; or `npx cap run android --target <id>`.
- Remote WebView debugging: `chrome://inspect` (Capacitor enables `webContentsDebuggingEnabled` for debug builds; `CapConfig.java:286`).

## 10. Capacitor vs. plain Kotlin single-Activity WebView (facts)

**What Capacitor concretely provides here**
- Project template and Gradle wiring; `cap sync` copies `native/shell-ui/dist` into assets.
- Local HTTPS-like origin `https://localhost` for shell-ui (`WebViewLocalServer`). Plain androidx equivalent: `WebViewAssetLoader` (`https://appassets.androidplatform.net`).
- JS plugin bridge for shell-ui: Preferences (server list), `CapacitorHttp` (CORS-free health check), App, LocalNotifications. This covers the `pikaShell` side in TS.
- `BridgeWebChromeClient`:
  - `<input type=file>` picker with camera/video capture and runtime permissions;
  - `getUserMedia` permission mapping (CAMERA/RECORD_AUDIO); note it grants for any requesting origin once the OS permission is granted;
  - geolocation, JS alert/confirm/prompt dialogs.
  - These are real, non-trivial code for chat attachments.
- SystemBars insets handling (WebView-version-aware passthrough vs. padding, IME padding).
- `cap build` signing helper.

**What must be hand-written regardless (Capacitor gives no API for it)**
- `pikaNative` injection limited to the connected origin (`addWebMessageListener` + `addDocumentStartJavaScript`, re-registered per connect, `sourceOrigin`/`isMainFrame` checks).
- Runtime navigation allow-list for the connected origin (custom `Plugin.shouldOverrideLoad` or a custom `BridgeWebViewClient`). Without it, remote redirects and full navigations open externally.
- Back-button policy across remote history -> shell-ui (native `OnBackPressedCallback`).
- Live `theme-color` -> decor/WebView background + bar icon appearance, including oklch->sRGB and coordination with SystemBars' decor-background reset.
- Notification posting and tap -> `onNewIntent` -> navigate (the LocalNotifications plugin is JS-only for the remote page's purposes).
- `onRenderProcessGone` recovery, file downloads (`DownloadListener`; none set by Capacitor), update check against GitHub releases.

**Costs and side effects of Capacitor in this design**
- Bridge plus Cordova runtime always present (8.x).
- Always-on core plugins (SystemBars touches decor background and injects CSS vars into any page; CapacitorHttp; WebView; Cookies).
- `launchIntent` default policy must be overridden for the remote origin.
- On WebViews lacking `WEB_MESSAGE_LISTENER`, Capacitor falls back to an all-origins `addJavascriptInterface("androidBridge")`. Raising `android.minWebViewVersion` or refusing to connect when the feature is missing are the knobs.
- Capacitor 9 (RC now) will need another migration (AGP 9, Gradle 9.8, minSdk 26, targetSdk 37).

A plain Kotlin app would use the same androidx APIs for the hand-written parts. It would additionally need its own versions of the shell-ui bridge (one message listener for the asset-loader origin), a file chooser / permission handler, SharedPreferences storage, a native HTTP health check, and the insets listener. Size estimates for either approach were not measured (**UNVERIFIED**).

## External references

- npm registry metadata for `@capacitor/*` (versions/dates above) — https://registry.npmjs.org/@capacitor/android
- Capacitor 8 migration — https://github.com/ionic-team/capacitor-docs/blob/main/docs/main/updating/8-0.md
- Capacitor 9 migration (RC) — https://github.com/ionic-team/capacitor-docs/blob/main/docs/main/updating/9-0.md
- SystemBars — https://capacitorjs.com/docs/apis/system-bars ; Http — https://capacitorjs.com/docs/apis/http
- Status Bar plugin README (Android 16 note) — https://github.com/ionic-team/capacitor-plugins/tree/main/status-bar
- LocalNotifications README — https://github.com/ionic-team/capacitor-plugins/tree/main/local-notifications
- androidx.webkit 1.18.0 sources (`WebViewCompat`, `ScriptHandler`) — https://dl.google.com/android/maven2/androidx/webkit/webkit/1.18.0/
- WebViewClient.shouldOverrideUrlLoading — https://developer.android.com/reference/android/webkit/WebViewClient
- Window insets in WebView — https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets
- Edge-to-edge (Views) — https://developer.android.com/develop/ui/views/layout/edge-to-edge
- Android 15 / 16 behavior changes — https://developer.android.com/about/versions/15/behavior-changes-15 , https://developer.android.com/about/versions/16/behavior-changes-16
- Cached apps freezer — https://source.android.com/docs/core/perf/cached-apps-freezer
- Gradle Java compatibility — https://docs.gradle.org/current/userguide/compatibility.html
- GitHub Ubuntu 24.04 runner image — https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md

## Related specs

- None specific to Android found under `.trellis/spec/`. The parent task `.trellis/tasks/11-16-native-apps/design.md` defines the `pikaNative` contract (it mentions `platform: "desktop" | "android"`, which is not in `src/global.d.ts`).

## Caveats / Not found

- UNVERIFIED:
  - minimum WebView versions for `WEB_MESSAGE_LISTENER` / `DOCUMENT_START_SCRIPT`;
  - Chromium serialising computed oklch as `oklch()` inside Android WebView;
  - WebView honouring `interactive-widget=resizes-content`;
  - renderer process freezing behaviour;
  - default `navigationBarDividerColor` in AppCompat DayNight;
  - CI build time and APK size.
- Foreground-service options for keeping a stream alive in the background were not researched.
- Capacitor 9 is RC as of 2026-11-12. Only its migration guide was read; its Android sources were not inspected.

## Spike verification on API 36 emulator (2026-11-18)

Tested on AVD `pika-api36` (Android 16, API 36, Google APIs x86_64, `com.google.android.webview` 133.0.6943.137) against local `pnpm dev` at `http://10.0.2.2:3000`:

- **(a) `theme-color` / computed `body.backgroundColor` format:** WebView 133 serialises `getComputedStyle(document.body).backgroundColor` as `lab(98.26 0 0)` (not `rgb()` and not `oklch()`). `meta[name=theme-color]` is empty (`content=""`) on `/sign-in` until `useThemeSync` runs, and our 1x1 canvas normalizer (`ctx.fillStyle = css; getImageData`) accurately converted `lab(98.26 0 0)` → `#fafafa`.
- **(b) `addWebMessageListener` + `addDocumentStartJavaScript` at runtime:** `WebViewFeature.WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT` are both `true`. After `webView.loadUrl("http://10.0.2.2:3000")` redirected to `/sign-in`, the document-start script executed in the main frame, `pikaSpikeHost.postMessage` delivered `sourceOrigin=http://10.0.2.2:3000, isMainFrame=true`, and Capacitor's own bridge did not run on the remote origin.
- **(c) Insets, edge-to-edge, and IME resize:**
  - Because `BridgeActivity.onCreate` calls `setTheme(R.style.AppTheme_NoActionBar)` and `SystemBars.initWindowInsetsListener()` runs inside `super.onCreate()`, `WindowCompat.enableEdgeToEdge(window)` and `window.isNavigationBarContrastEnforced = false` must be called **after** `super.onCreate()`, and the manifest `application` theme should be `@style/AppTheme.NoActionBar` (not `Theme.AppCompat.Light.DarkActionBar` which briefly flashes an action bar or affects theme attributes).
  - Emulator ships WebView 133 (`< 140`), so SystemBars operates in **padding mode** (`decorView` padded `[0,136][1080,2337]`, CSS `env(safe-area-inset-*)` = `0px`). Painting both `window.decorView.setBackgroundColor(c)` and `webView.setBackgroundColor(c)` produced uniform `(250, 250, 250)` pixels across status bar, content, and both gesture nav and 3-button nav (`com.android.internal.systemui.navbar.threebutton`) with zero hairline gap.
  - Opening the IME resized `window.innerHeight` and `visualViewport.height` from `839` to `527` (`interactive-widget=resizes-content` + SystemBars `ime.bottom` padding), and closing it restored `839` with no ghost padding.
- **(d) `copyBackForwardList()` with Next.js `pushState`:** Starting from `https://localhost/` → `loadUrl("http://10.0.2.2:3000")` (redirect to `/sign-in`) gave `bfSize=2`; after `history.pushState({}, "", "/sign-up")`, `copyBackForwardList().size` became `3`, confirming Next.js client navigations appear in WebView's back-forward list.
- **(e) `visibilityState` vs `document.hasFocus()` on pause:** Pressing `HOME` triggered `Activity.onPause` and immediately fired `visibilitychange` with `visibilityState="hidden"` while `hasFocus()` remained `true`; returning to the app fired `visibilitychange` with `visibilityState="visible"` (`hasFocus=true`). Since `ChatPoolBridge` checks `document.visibilityState !== "visible" || !document.hasFocus()`, `notify` triggers reliably when backgrounded before Android's cached-app freezer suspends the process.
