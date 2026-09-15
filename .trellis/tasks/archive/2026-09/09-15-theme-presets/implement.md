# Implement — 主题系统

按依赖顺序执行；每步后运行对应验证。全程遵循 `.trellis/spec/frontend/component-guidelines.md`、`frontend/i18n.md`、`backend/database-guidelines.md`、`backend/error-handling.md`。

## Phase A — 机制与数据层

- [ ] A1. `src/lib/theme.ts` 扩展：`THEME_PRESETS`、`ThemePreset`、`parseThemePreset`、`ThemePreference`；cookie 升级三段格式 `mode:resolved:preset`，`parseThemeCookie` 兼容旧两段格式；`themeDocumentCookie` / `serializeThemeCookie` 同步。
  - 验证：`pnpm test src/lib/theme`（新增解析单测：三段/两段/非法值）
- [ ] A2. users 表加列 `theme_mode` / `theme_preset`（`src/server/db/schema/auth.ts`），`pnpm db:generate` 产出 migration。
  - 验证：migration SQL 含默认值与非空约束；`pnpm typecheck`
- [ ] A3. `user-preferences.service.ts`：`getUserThemePreference(userId)` + `updateUserThemePreference(userId, patch)`（zod 校验值域）。
  - 验证：service 集成测试（参考 user-quota.service.integration.test.ts 模式）
- [ ] A4. `PATCH /api/account/preferences` 路由（requireActor + zod body + AppError）。
  - 验证：集成测试：200 更新 / 400 非法值 / 401 未登录

## Phase B — 渲染链路改造

- [ ] B1. root layout：resolveActor（不 redirect）→ DB/cookie 双源取 `{mode, preset, resolved}`；渲染 `dark` class + `data-theme`（default 不写属性）。
- [ ] B2. `(app)/layout` + AppShell：透传 DB 的 mode/preset；settings/general 服务端读 DB 渲染 initial。
- [ ] B3. `use-theme-sync.ts` / ThemeSync：`persistTheme(pref)` 同步 dark class、`data-theme`、三段 cookie；props 升级为 `initialPreference`。
  - 验证：ThemeSync / use-theme-sync 既有测试更新通过
- [ ] B4. `useUpdateThemePreference` hook + ThemeControl 接入（乐观应用 + PATCH + refresh + 失败 toast 回滚）。侧栏与 settings 页共用。
  - 验证：ThemeControl 测试更新；`pnpm test`

## Phase C — 预设与视觉

- [ ] C1. 默认主题打磨：`:root` / `.dark` 调值（分层、边框温度、dark 梯度），截图对比人工确认。
- [ ] C2. 6 预设 × 明暗 = 12 个 token 块写入 globals.css（含 `src/lib/theme-presets.ts` 预览常量）。
- [ ] C3. `scripts/check-theme-tokens.mjs` + package.json `check:themes` script；故意删一个 token 验证脚本报错后还原。
- [ ] C4. settings/general 外观区块 + ThemePresetControl（色板缩略卡片网格）；i18n key（en + zh-CN 同步）。
  - 验证：`pnpm typecheck`（消息类型联动）

## Phase D — 全量验证（review gate）

- [ ] D1. `pnpm lint && pnpm typecheck && pnpm test && pnpm check:themes`
- [ ] D2. 人工走查矩阵（dev server）：7 主题（default+6）× 明暗 × 关键页面（chat 气泡/markdown 代码块/mermaid/设置页/侧栏），确认无破版、对比度可接受。
- [ ] D3. 持久化走查：登录改主题 → 刷新/另一浏览器生效；退出登录 → 匿名页回 cookie 主题；system 模式 SSR 无闪烁（禁用 JS 检查首屏 HTML class/data-theme）。
- [ ] D4. migration 在既有数据上正向迁移验证。

## 回滚点

- Phase A 完成即独立可合（DB 列 + API，无 UI 变更）。
- Phase B 完成后若 Phase C 延期，系统行为与现状等价（唯一预设=default）。
- 视觉问题单独 revert globals.css 即可，不影响持久化链路。
