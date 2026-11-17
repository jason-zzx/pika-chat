# Mobile shell options (remote mode only)

Constraint: UI is the server-rendered web app (RSC + cookie session), so every
wrapper option renders chat inside the platform WebView (WKWebView / Android
System WebView). Rendering quality is the same across wrappers; differences are
native integration maturity and shell UX.

| Option | Chat UI | Native integrations | Cost |
|---|---|---|---|
| PWA | Safari/Chrome | iOS: push only when installed (16.4+), no share target; Android: share target ok; no store listing | lowest |
| Capacitor | WebView | Mature plugins: keyboard resize modes, push (APNs/FCM), status bar, haptics, biometrics, share intents (community); bridge injectable into remote URL | low |
| Tauri 2 mobile | WebView | Younger ecosystem; remote-origin IPC via capabilities; push / share extension largely DIY Swift/Kotlin | low-medium |
| Expo / React Native + WebView | WebView for chat, native screens for server list/settings | Best plugin ecosystem (expo-notifications, share intent, OTA); web<->native via postMessage | medium |
| Native client (SwiftUI/Compose/RN/Flutter calling /api) | Native | Full | very high: needs JSON APIs for RSC-only data, re-implement Markdown/KaTeX/Mermaid/attachments, second UI to maintain |

Experience-critical items for a chat app on mobile: input bar vs. soft keyboard
(iOS WKWebView viewport), back-swipe, scroll smoothness, share-sheet into chat,
push on generation completion, camera/file picker, biometric lock.

App Store guideline 4.2 (minimum functionality) can reject a bare website
wrapper; native features (push, share extension, biometrics) mitigate.
