# Implement: Search command palette modal

## Checklist

1. **Zustand store**：新建 `src/stores/search-dialog.ts`（或按 directory-structure spec 的 stores 位置），`{ open, setOpen }`。
2. **SearchDialog**：新建 `src/components/assistant/SearchDialog.tsx`
   - Dialog + 输入框（autoFocus）+ 分组结果（复用 `useDebouncedValue`/`useSearch`）。
   - 从 `SearchResults.tsx` 迁入 `HighlightedText` / `HighlightedTitle` / `messageHitHref`。
   - 扁平结果键盘导航（activeIndex、↑/↓ clamp、Enter 选择）。
   - 选中消息命中：`hits.length >= 2` 时写 sessionStorage 队列 → `setOpen(false)` → `router.push(messageHitHref)`；选中话题：直接 push。
   - Ctrl/Cmd+K 全局监听（preventDefault），Esc 由 Dialog 自带处理。
3. **AppShell 挂载**：`src/components/layout/AppShell.tsx` 渲染 `<SearchDialog/>`。
4. **SidebarSearch 退化**：`src/components/assistant/SidebarSearch.tsx` 输入框改 readOnly 入口（onFocus/onClick → setOpen(true)）；图标轨按钮直接 setOpen(true)，删除 focusOnExpandRef 逻辑。
5. **AssistantTree 清理**：`src/components/assistant/AssistantTree.tsx` 删除 `searchQuery` state 与 `SearchResults` 分支，树常驻。
6. **删除 SearchResults.tsx**。
7. **ChatView hit-nav**：`src/components/chat/ChatView.tsx`
   - 抽 `flashMessage(key)`（scrollToMessage + 2s highlight）。
   - `?m` effect 确认跳转分支后 consume sessionStorage 队列，校验通过则 `setHitNav`。
   - `activeTopicId` 变化时清空 `hitNav`。
8. **SearchHitNav 控件**：新建 `src/components/chat/SearchHitNav.tsx`（`k / n` + ↑ ↓ ×，absolute bottom-20 right-4）。
9. **i18n**：`messages/en.json`、`messages/zh-CN.json` 加 `Search.palette.*`（openSearch 迁入，prevHit/nextHit/closeNav 新增），复用 sidebar 既有 key。
10. **测试**：
    - 重写 `src/components/assistant/SidebarSearch.test.tsx`：入口行为（点击/聚焦开弹窗）、删除内联结果断言。
    - 新增 `src/components/assistant/SearchDialog.test.tsx`：debounce 结果渲染、空态、键盘导航、消息命中写 sessionStorage + 跳转、话题命中不写队列。
    - ChatView hit-nav：若现有 ChatView 测试基架可用则加 consume/校验/切换话题消失用例；成本高则将队列 consume 逻辑抽为纯函数（`consumeHitQueue(topicId, key)`）单测。
11. **质量门**：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿；按 frontend spec quality checklist 过一遍（两断点、键盘可达、aria-label）。

## Validation Commands

```bash
pnpm lint && pnpm typecheck && pnpm test
```

人工验证（两断点）：
- AC1–AC8 弹窗流程；AC9–AC11 hit-nav 流程（构造同话题 ≥2 条命中的搜索词）。

## Risky Files / Rollback Points

- `src/components/chat/ChatView.tsx`（时序敏感 effect，改前先在「确认跳转」分支定位插入点）——回滚点：步骤 7-8 独立成 commit。
- `src/components/assistant/AssistantTree.tsx`（删 state 影响树渲染路径）。
- 整体回滚：revert 即恢复，无数据层变更。

## Commit Plan（建议）

1. `feat(search): command palette modal with Ctrl+K entry`（步骤 1-6、9、10 弹窗部分）
2. `feat(search): in-topic next-hit navigation`（步骤 7-8、10 hit-nav 部分）

## Pre-start Checks

- [x] prd.md / design.md 齐备。
- [ ] implement.jsonl / check.jsonl 已配置 spec 条目。
