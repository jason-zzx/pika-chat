# Pika Chat Android shell

Capacitor 8 app that bundles `native/shell-ui` (server list, connection checks) and loads the chosen server top-level in the WebView. Design and decisions: `.trellis/tasks/11-16-native-mobile/`; contracts: `.trellis/spec/guides/native-shell.md`.

## Toolchain (no Android Studio)

- JDK 21 (Temurin). Fedora has no `java-21` package and Gradle 8.14 cannot run on JDK 25: unpack the Temurin 21 tarball and point `JAVA_HOME` at it.
- Android SDK command-line tools in `~/Android/Sdk`:

```bash
export ANDROID_HOME=$HOME/Android/Sdk
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "emulator" "system-images;android-36;google_apis;x86_64"
avdmanager create avd -n pika-api36 -k "system-images;android-36;google_apis;x86_64"
emulator -avd pika-api36
```

## Build and run

```bash
pnpm -C native install
pnpm -C native/mobile build                # vite -> dist (Capacitor webDir)
pnpm -C native/mobile exec cap sync android
cd native/mobile/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`versionName` / `versionCode` come from the root `package.json`. A release build is signed only when `ANDROID_KEYSTORE_PATH` and `ANDROID_KEYSTORE_PASSWORD` are set (PKCS12, alias `pika-chat`, key password = store password); CI supplies them from the `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` secrets. Losing the keystore means installed users must uninstall before updating.

## Testing against `pnpm dev`

The Next dev server answers 403 to client chunks requested from an unlisted host (`10.0.2.2`), so the page never hydrates and `window.pikaNative` consumers (server chip, switcher) stay hidden. Forward the port instead and use `http://localhost:3000` as the server URL:

```bash
adb reverse tcp:3000 tcp:3000
```

Inspect the WebView through `adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>` and `http://localhost:9229/json`.
