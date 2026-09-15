# Design — 主题系统

## 1. 预设渲染机制

### 1.1 主题标识

`<html>` 增加 `data-theme` 属性：

- 默认主题：**不写** `data-theme`，token 完全来自现有 `:root` / `.dark`。
- 预设主题：`data-theme="paper"` 等，CSS 选择器 `[data-theme="paper"]` 与 `[data-theme="paper"].dark` 各定义一组完整 token 块。

`data-theme` 与 `dark` class 是两个正交维度：`dark` 决定明暗（沿用现有机制），`data-theme` 决定色板族。

### 1.2 预设 CSS 组织

`src/app/globals.css` 末尾追加预设块，格式：

```css
[data-theme="paper"] {
  --background: oklch(...);
  /* …全部 :root token… */
}
[data-theme="paper"].dark {
  --background: oklch(...);
  /* …全部 .dark token… */
}
```

- 纯静态 CSS，无运行时计算。
- 6 预设 × 2 模式 = 12 个块。块内 token 集合必须与 baseline（`:root` / `.dark`）完全一致（见 1.3 校验）。
- 文件变长可接受（单文件静态 token 声明）；若超过可维护阈值再拆 `src/app/themes/*.css` 并 `@import`，初版先内联在 globals.css。

### 1.3 token 覆盖校验脚本

`scripts/check-theme-tokens.mjs`（纯文本解析，无依赖）：

1. 解析 globals.css，提取 `:root` 与 `.dark` 块中的 `--*` 自定义属性名集合作为 baseline。
2. 对每个 `THEME_PRESETS` 中的预设，要求 `[data-theme="X"]` 块集合 ⊇ light baseline，`[data-theme="X"].dark` 块集合 ⊇ dark baseline。
3. 预设名单与 `src/lib/theme.ts` 中的 `THEME_PRESETS` 常量同源（脚本 import 或共享 JSON），避免两处漂移。
4. 挂入 `pnpm lint` 或独立 `pnpm check:themes` 并在 quality 流程中调用（具体以 package.json scripts 现状为准）。

### 1.4 默认主题打磨（R1 调整幅度约束）

仅调值不调结构，幅度上限：

- light：`--card` / `--popover` 与 `--background` 拉开 ≤ 0.02 L 的层次；`--border` / `--input` 引入 ≤ 0.008 chroma 的微弱温度。
- dark：顺化 `--muted-foreground` / `--ring` / `--accent` 的明度梯度。
- 最终以截图对比人工确认"看不出变了什么但感觉精致了"为准。

## 2. 数据模型与持久化

### 2.1 schema

`src/server/db/schema/auth.ts` users 表追加：

```ts
themeMode: text("theme_mode").notNull().default("system"),
themePreset: text("theme_preset").notNull().default("default"),
```

- 沿用 `fileQuotaBytes` 的加列先例；`pnpm db:generate` 产出 migration，既有行自动取默认值，无需回填。
- 列值域由应用层 zod 守卫（`ThemeMode` / `ThemePreset`），不加 DB enum（与现有 `role` 列风格一致）。

### 2.2 类型与解析（`src/lib/theme.ts` 扩展）

```ts
export const THEME_PRESETS = ["default", "paper", "graphite", "ocean", "forest", "rose", "violet"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export type ThemePreference = { mode: ThemeMode; preset: ThemePreset };

export function parseThemePreset(raw: unknown): ThemePreset; // 非法 → "default"
```

- cookie 格式保持 `mode:resolved` 不变（preset 不进 cookie——匿名页面无需预设？**否**：匿名页面也需要预设，否则用户在登录页看到的和登录后不一致）。

**决策：cookie 格式升级为 `mode:resolved:preset`**，`parseThemeCookie` 兼容旧两段格式（缺第三段 → preset=default）。序列化始终写三段。

### 2.3 SSR 读取路径

新增服务端 helper（如 `src/server/services/user-preferences.service.ts`）：

```ts
getUserThemePreference(userId): Promise<ThemePreference>
```

- **root layout**（`src/app/layout.tsx`）：
  1. `resolveActor(await headers())`（仅主题用途，不 redirect）。
  2. 有 actor → 读 DB 得 `{mode, preset}`；无 actor → cookie 解析。
  3. `resolved`：mode ≠ system 时 = mode；mode = system 时取 cookie 中的 resolved 提示（服务端无法探测系统偏好——这是 cookie 必须保留的核心原因）。
  4. 渲染 `<html class={dark?} data-theme={preset ≠ default ? preset : undefined}>`。
- **(app)/layout**：同样以 DB 为准，把 `themeMode` + `themePreset` 传给 AppShell。
- **settings/general**：服务端读 DB 值渲染两个控件的 initial 值。

注意：root layout 目前不查 session，新增后每个请求多一次 session 查询——`(app)` 页面本来就要 resolveActor，Next 的请求级缓存（React cache / per-request dedupe）可消化，不引入额外缓存层。

### 2.4 写入路径

**API**：`PATCH /api/account/preferences`

- `requireActor` 鉴权；body zod：`{ themeMode?: "light"|"dark"|"system", themePreset?: enum(THEME_PRESETS) }`（至少一个字段）。
- service 层更新 users 表两列；非法值 400（AppError，沿用 error-handling spec）。
- 响应 `{ themeMode, themePreset }`。

**客户端流**（ThemeControl 与新的 ThemePresetControl 共用 `useUpdateThemePreference` hook）：

1. 立即本地应用：classList 切 `dark`、`documentElement.dataset.theme`、写 cookie（三段格式）。
2. `startTransition` 内 `fetch PATCH`；成功 → `router.refresh()`（让服务端树以 DB 为准重渲）。
3. 失败 → toast（apiErrorMessageFromUnknown 解析）+ 重新应用旧值（本地 classList/dataset/cookie 回滚）。

### 2.5 ThemeSync 扩展

`ThemeSync` / `persistTheme` 目前只处理 mode：

- `persistTheme` 签名扩展为 `(pref: ThemePreference)`，同时切 dark class、`data-theme`、写 cookie。
- `useThemeSync` 的 system 监听逻辑不变。
- props 从 `initialMode` 升级为 `initialPreference`（root layout 传入）。

## 3. UI 设计

### 3.1 settings/general

在现有 SettingsCard 之后新增第二个 SettingsCard「外观/Appearance」：

- `SettingsRow`（mode）：保留现有 ThemeControl（循环按钮或改 Select，保持现状即可，本任务不改交互形式）。
- 预设选择器 `ThemePresetControl`（client component）：6 个预设的色板缩略卡片网格（每卡展示该预设的 background/foreground/primary/accent 微缩预览 + 名称），当前选中显示 ring/check 指示。
  - 缩略预览直接用预设的真实 token 值内联 style（静态数据，从 `src/lib/theme-presets.ts` 的预览常量取，与 CSS 块同源维护）。
  - 明暗预览随当前 resolved mode 展示对应半套色板。

### 3.2 侧栏 ThemeControl

交互不变（light → dark → system 循环），持久化改为走 2.4 的 hook（乐观应用 + PATCH + refresh）。

### 3.3 i18n

新增 `Settings.General.appearance*`、预设名 `theme.presets.{paper,…}`、失败 toast key；en 与 zh-CN 同步（spec: frontend/i18n.md）。

## 4. 各预设色板方向（设计基调，具体值在实现时调校）

| 预设 | light 基调 | dark 基调 | accent/primary 倾向 |
|---|---|---|---|
| paper | 暖米白底（~30-60° hue, 低 chroma），暖灰文字 | 深暖棕灰 | 暖橙棕点缀 |
| graphite | 冷灰微蓝（~250-260°，chroma ≤0.01） | 深石墨蓝 | 冷蓝点缀 |
| ocean | 中性微冷，蓝色 accent | 深海军蓝底（主场） | 亮蓝 |
| forest | 中性微绿 | 深墨绿灰 | 低饱和绿 |
| rose | 暖粉白底 | 深玫瑰棕灰 |  dusty rose |
| violet | 中性微紫 | 深紫灰 | 低饱和紫，高级感（chroma 克制，避免艳紫） |

共同约束：destructive/success 语义色在所有预设中保持可辨认（可微调 hue 但不与 accent 混淆）；前景/背景对比度 ≥ WCAG AA（正文 4.5:1）。

## 5. 已知取舍

- **mermaid**：`DARK_THEME_VARIABLES` 硬编码中性灰 hex，12 套色板共用。中性灰与各预设底色均不冲突，接受；后续若某预设明显打架再按预设派生（需解决 khroma 不解析 oklch 的问题）。
- **shiki**：继续 `dark:` class，不按预设定制。
- **chart token**：无组件消费，只需色板内协调。
- **多标签页同步**：不做 storage 事件广播（cookie 同域可后续增强，非本任务目标）。

## 6. 兼容性 / 回滚

- 旧两段式 cookie 自动兼容（解析时 preset=default）。
- 既存用户行 migration 后自动获得 system + default，视觉与升级前一致（默认主题打磨的微调除外，属预期变更）。
- 回滚 = revert migration + 代码回退；DB 新增列可保留无害。
