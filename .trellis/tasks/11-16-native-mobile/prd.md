# Mobile shell remote mode (Android)

Parent: `11-16-native-apps` (D1, D4, D5, D7; `pikaNative` contract in parent `design.md`).
Depends on: `11-16-native-desktop-remote` (shared `native/shell-ui`, health `version`, `pikaNative` web hook).

## Goal

An Android APK that connects to deployed Pika servers with a native-feeling shell.

## Requirements (to be refined into design.md / implement.md before start)

- Capacitor project in `native/mobile`, bundling `native/shell-ui`; navigates to the chosen server origin.
- `pikaNative.notify` implemented with Capacitor `LocalNotifications` (runtime permission on Android 13+).
- Keyboard resize mode keeps the composer visible; hardware back navigates history then returns to shell-ui; status bar **and navigation bar** follow the in-app theme (mode + preset) live, with no hairline gap at the bottom. The PWA cannot do this: Android paints an installed PWA's nav bar and window background from the static manifest colors.
- External origins open in the system browser.
- Update check against latest GitHub release with download prompt.
- `release.yml` builds a signed release APK (keystore from repo secret) on `v*` tags and attaches it to the release.

## Acceptance Criteria (draft)

- [ ] Install APK, add server, sign in, chat; app restart keeps the session.
- [ ] Backgrounding the app during generation and returning shows the finished result; completion notification appears while the app is alive.
- [ ] Keyboard, back button, status bar, external links behave as specified.
- [ ] Tag build attaches the APK to the release.

## Out of Scope

- iOS, Play Store, share-target, deep links, remote push.
