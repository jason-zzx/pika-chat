# 消息翻译 — 执行计划

> 验证命令：`pnpm lint` · `pnpm typecheck` · `pnpm test`（必要时 `pnpm vitest run <file>` 单测）
> 迁移：`pnpm db:generate` 生成迁移文件（由用户执行 `pnpm db:migrate` 应用）

## Checklist

1. [x] **共享常量**：`src/lib/translate/languages.ts`（8 种语言，code + nativeName）。
2. [x] **DB schema**：`chat_messages` 增加 `translations` jsonb nullable；`pnpm db:generate`。
3. [x] **schema/metadata 透出**：`chatMetadataSchema` 增加 `translations` record；`listTopicMessages` 映射进 metadata。
4. [x] **翻译路由**：`POST /api/translate/route.ts`——归属校验（message→topic→assistant→actor）、缓存命中直返、`generateText` 翻译（当前会话模型，提示词"只输出译文/保持 markdown/同语言原样返回"）、merge 持久化、返回译文。
5. [x] **MessageActions**：Languages 图标 + 8 语言 DropdownMenu（user/assistant 均显示；沿用组件内菜单模式，遵守触摸约束）。
6. [x] **MessageItem 译文块**：正文下方 muted 译文区（语言标签 + Markdown；remount key 含语言码，约束 #40）；翻译成功后更新 React Query 缓存。
7. [x] **i18n**：`Chat.Actions.translate`、`Chat.Translation.*` 中英文案。
8. [x] **测试**：语言常量、schema 扩展、菜单渲染单测；翻译路由集成测试（归属/缓存/merge）。
9. [ ] **翻译进行中提示**（用户反馈，PRD R5/AC8）：`ChatView` 新增 `translating: { messageId, targetLang } | null` 状态（请求前置位、`finally` 清理），经 `MessageList` 透传给 `MessageItem`；`MessageItem` 在译文位置渲染闪动"正在翻译为{目标语言}"块（`role="status"`，文案 `Chat.Translation.translating`，语言名用本地名称）。
10. [ ] **译文块可折叠**（用户反馈，PRD R6/AC9）：`TranslationBlock` 增加折叠控件（chevron + `aria-expanded`/`aria-controls`，参考 `ToolCallShell` 折叠机制，不得新建 ui/collapsible 原语），默认展开，多语言各自独立状态。
11. [ ] **译文引用渲染修正**（用户反馈，PRD R7/AC10）：`TranslationBlock` 接收并传入 `citations` 给 `Markdown`（`collectCitationSources(message.parts)` 已有），使译文中的 `[n]` 渲染为引用 chip；确认已有 citation 的 remount key 约定仍然成立。
12. [ ] **测试补充**：`MessageItem.test.tsx` 覆盖（a）译文含 `[n]` 时渲染 citation chip 而非字面文本、（b）折叠/展开行为、（c）`translatingTargetLang` 提示渲染；`MessageList`/`ChatView` 覆盖提示透传。

## 风险文件与回滚点

- `src/components/chat/MessageActions.tsx` / `MessageItem.tsx`（聊天 UI 核心）——步骤 1-4（纯服务端 + 常量）先行落地并验证，再做 UI。
- 持久化 merge 必须只更新目标语言键，不得整体覆盖 `translations`。

## 评审门

- 实现子代理不得修改 spec 文档、不得做清单外重构（项目规则 #102）。
- 完成后由 trellis-check 全量验证。
