# 主题系统：默认主题打磨 + 6 预设主题 + DB 持久化

## Goal

打磨中性默认主题，新增 6 套完整预设主题（paper/graphite/ocean/forest/rose/violet，各含明暗双色板），主题选择入口放在 settings/general，主题预设与明暗模式持久化到 users 表（DB 为登录用户唯一真源，cookie 降级为匿名页面回退 + system 模式的 resolved 提示）。

## Context

- 现状：Tailwind v4 + shadcn CSS 变量 token 体系（oklch，`:root` / `.dark` 各约 30 个 token），当前所有 chroma = 0（纯黑白灰）。
- 明暗模式持久化目前只有 cookie（`pika_theme`，格式 `mode:resolved`），root layout SSR 读 cookie 设置 `<html>` 的 `dark` class，无闪烁。ThemeControl 在 settings/general 和侧栏各有一处，点击后写 cookie + `router.refresh()`。
- 用户明确决策（2026-09-15 讨论）：
  1. 预设主题方向（非自由选色器）；默认主题打磨但保持简洁，不太花。
  2. 6 个预设：paper（暖纸/Claude 气质）、graphite（冷灰蓝/Vercel 气质）、ocean（深蓝）、forest（墨绿低饱和）、rose（暖粉灰）、violet（高级感紫色系）。
  3. 主题选择 UI 放 settings/general（不新开 appearance 页）；侧栏明暗循环按钮保留，只管 mode。
  4. 三件事一个任务完成。
  5. 主题预设 + 明暗模式持久化进数据库，不再只存 cookie。

## Requirements

### R1 默认主题打磨

- 保持中性、简洁的整体气质，不引入明显色相。
- 通过背景/card/popover 的明度分层、边框微弱温度、dark 模式层次顺化提升质感。
- 改动仅限 token 值，不改 token 集合结构。

### R2 预设主题机制

- 6 个预设，每个预设定义完整的 token 集合，且 light / dark 成对提供（共 12 套色板）。
- 预设通过 `<html>` 上的主题标识切换（SSR 直接渲染，无闪烁，复用现有 cookie+SSR 模式的理念）。
- 默认主题 = 无预设标识，完全回退到 `:root` / `.dark`。
- 预设必须是纯静态 CSS（tweakcn 风格），不允许运行时 JS 计算颜色。
- 工程保障：提供 token 覆盖完整性校验脚本，任一预设块缺失 baseline（`:root` / `.dark`）中定义的 token 时失败；接入常规检查流程。
- 已知取舍（接受）：mermaid 深色变量是硬编码中性灰 hex（khroma 无法解析 oklch），所有预设共用，不随预设变化；shiki 代码高亮继续走 `dark:` class；chart token 目前无组件消费，只需保持色板内协调。

### R3 主题选择 UI

- settings/general 新增外观区块：6 个预设的可视化选择器（色板缩略预览，非文字列表），当前选中有明确指示；明暗 mode 行保留现有 ThemeControl。
- 选择即时生效（本地立即应用，零延迟），失败有反馈。
- 侧栏 ThemeControl 循环按钮保留，仅切换 light/dark/system，行为与 settings 页一致。
- 全部新增文案 i18n（en + zh-CN 同变更）。

### R4 DB 持久化

- users 表新增 `theme_mode`（light/dark/system，默认 system）与 `theme_preset`（默认 default）两列，drizzle migration。
- 登录用户：DB 为唯一真源，SSR 每请求从 DB 读取并直接渲染正确 class/属性（root layout 已是动态渲染，无闪烁）。
- cookie 保留但降级：(a) 匿名页面（登录/注册）的主题来源；(b) mode=system 时 resolved 的客户端提示（服务端无法探测系统偏好）。每次本地变更继续写 cookie。
- 提供认证的偏好更新接口（zod 校验非法值），客户端乐观应用 + 后台持久化 + 失败回滚提示。
- 跨设备：任一设备修改后，其他设备下次加载生效（最终一致，不做实时推送）。

### 非目标

- 不做自由选色器 / 自定义 accent 覆盖（预设 + 自定义组合会引爆 QA 矩阵）。
- 不做 mermaid / shiki / chart 的按预设定制配色。
- 不做管理后台强制实例级主题。

## Acceptance Criteria

- [ ] 默认主题明暗两色板完成打磨，视觉分层改善且无新色相。
- [ ] 6 个预设 × 明暗共 12 套色板全部落地，chat 气泡、markdown、代码块、设置页、侧栏在各预设下无破版、无明显对比度问题。
- [ ] token 覆盖校验脚本通过，且在预设缺 token 时确实报错。
- [ ] settings/general 可选预设，点击即时生效、刷新后保持；侧栏明暗循环正常工作。
- [ ] 登录用户主题存 DB：A 设备修改，B 设备重新加载后生效；退出登录后匿名页面回退 cookie 主题；mode=system 在 SSR 下不闪烁（依赖 cookie resolved 提示）。
- [ ] 非法 preset/mode 值被接口拒绝（400），非法 cookie 值回退默认。
- [ ] migration 可正向迁移既有部署（既有用户行自动获得默认值）。
- [ ] 新增/变更的 en 与 zh-CN 文案同步，`pnpm typecheck`、`pnpm lint`、相关测试通过。

## Notes

- 技术方案见 `design.md`，执行计划见 `implement.md`。
