# Implement — Native desktop & mobile apps (parent)

The parent has no direct code. Order of child work:

1. `11-16-native-pwa` — independent, smallest, unblocks iOS users. PRD-only.
2. `11-16-native-desktop-remote` — creates `native/`, shell-ui, Electron shell, health `version`, `pikaNative` web hook, `native.yml`. Needs `design.md` + `implement.md` before start.
3. `11-16-native-desktop-local` — starts with the PGlite spike (run existing integration tests against PGlite); decide PGlite vs embedded-postgres before the rest. Needs `design.md` + `implement.md` before start.
4. `11-16-native-mobile` — Capacitor Android reusing shell-ui and the `pikaNative` contract. Needs `design.md` + `implement.md` before start.

Child design/implement artifacts are written when the previous child is archived, so they build on the shipped code.

## Integration review (after all children)

- Tag a pre-release `vX.Y.Z-rc.1` and confirm every artifact attaches to one GitHub Release.
- Install each artifact once: Windows, macOS (quarantine steps from README), Linux AppImage, Android APK.
- `pnpm lint && pnpm typecheck && pnpm test` green; Docker image unchanged in behavior.
- Changelog entries in both `CHANGELOG.md` and `CHANGELOG.zh-CN.md`.
