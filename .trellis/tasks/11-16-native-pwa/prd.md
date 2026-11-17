# PWA installable web app

Parent: `11-16-native-apps` (see its `prd.md` D5: iOS users rely on the PWA).

## Goal

Users can install Pika Chat from Safari (iOS "Add to Home Screen") and Chrome/Edge (Android, desktop) and get an app-like standalone window that respects notches, home indicator, and the soft keyboard.

## Repo Facts

- No manifest, `export const viewport`, `appleWebApp` metadata, or `public/` dir.
- Icons available: `src/app/icon.svg`, `src/app/apple-icon.png` (180×180), `src/app/favicon.ico`.
- Root metadata is request-scoped via `generateMetadata` (`src/app/layout.tsx`) for i18n titles.
- App shell uses `h-svh overflow-hidden` (`src/components/layout/AppShell.tsx:32`); sidebar uses `h-svh` / `min-h-svh` (`src/components/ui/sidebar.tsx:142,235`).
- Theme presets with light/dark palettes (`.trellis/spec/frontend/theming.md`).

## Requirements

- P1 Web app manifest via `src/app/manifest.ts`: name/short_name "Pika Chat", `start_url: "/"`, `display: "standalone"`, `background_color`/`theme_color` matching the default theme, icons 192 & 512 PNG plus a 512 maskable PNG.
- P2 Viewport: `viewport-fit=cover`, `interactive-widget=resizes-content`, `theme-color` for light and dark color schemes.
- P3 iOS: `appleWebApp` metadata (capable, title, status bar style) so the home-screen launch is standalone.
- P4 Safe areas: top bar, sidebar, and composer pad with `env(safe-area-inset-*)` so nothing sits under the notch, status bar, or home indicator; normal browser tabs (insets = 0) look unchanged.
- P5 Soft keyboard: on iOS Safari standalone and Android Chrome, focusing the composer keeps the input and send button visible above the keyboard, and the message list stays scrollable.
- P6 No service worker / offline mode unless a target browser refuses installability without one.

## Out of Scope

- Offline support, background sync, web push, share target.
- Per-preset manifest colors (manifest is static; theme-color meta follows the active scheme only).

## Acceptance Criteria

- [ ] Chrome DevTools → Application → Manifest shows no installability errors; Chrome/Edge desktop and Android offer "Install".
- [ ] iOS Safari "Add to Home Screen" launches without browser chrome, with the Pika icon and title.
- [ ] On an iPhone with a notch (or simulator) in standalone mode, header and composer are not obscured; same check in landscape.
- [ ] Focusing the composer on iOS standalone and Android Chrome keeps the composer fully visible; closing the keyboard restores layout without a gap.
- [ ] Desktop browser tab rendering is unchanged (visual check of chat and settings pages).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
