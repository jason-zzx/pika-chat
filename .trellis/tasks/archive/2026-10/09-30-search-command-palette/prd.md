# Search command palette modal

## Goal

把话题/消息搜索从「侧栏内嵌」改为「命令面板式弹窗」：点击/聚焦侧栏搜索框或按 Ctrl+K 唤起居中弹窗，在弹窗内输入并展示分组结果，选中后关闭弹窗并跳转高亮。命中消息跳转后，话题内提供「下一条命中」导航，避免多命中时反复折返弹窗。

## Confirmed Facts (repo evidence)

- 搜索状态目前由 `AssistantTree` 持有（`searchQuery`），`SidebarSearch` 为输入框、`SearchResults` 在搜索激活时替换话题树（`src/components/assistant/AssistantTree.tsx:83-136`）。
- 数据层无需改动：`useSearch` + `useDebouncedValue`（`src/components/assistant/use-search.ts`）→ `/api/search`，返回 `{ topics, messages }`，各自上限 20 条，消息按 `createdAt desc` 排序。
- `MessageHit` 含 `messageId / groupId / topicId / assistantId / topicTitle / role / snippet / createdAt`（`src/lib/schemas/search.ts`），字段足以构建话题内命中队列。
- 深链机制已存在：`?m=<groupId>` → `ChatView.tsx:473-504` 滚动定位 + 2s 高亮后剥离参数；`scrollToMessage(key)` 由 `MessageList` ref 暴露，目标已删除时 no-op。
- 结果高亮组件 `HighlightedText`/`HighlightedTitle` 与 `messageHitHref` 在 `SearchResults.tsx`，可迁移复用。
- 全局快捷键已有先例：sidebar 的 Ctrl/Cmd+B（`src/components/ui/sidebar.tsx:102-109`）。
- 已有 `Dialog` 组件（`src/components/ui/dialog.tsx`）作为弹窗基础；`MessageList` 已有绝对定位浮动按钮模式（scroll-to-bottom，`MessageList.tsx:651-662`）。
- 侧栏折叠为图标轨时，搜索按钮目前会展开侧栏并聚焦输入框（`SidebarSearch.tsx`）；改为弹窗后直接开弹窗即可。
- 搜索 l10n key 命名约定：嵌套在 `Search` 的二级子空间下（顶层 `Search` 保留给联网搜索设置，#255）；弹窗使用新子空间 `Search.palette.*`。
- 项目规则：操作入口不得只藏在 hover 后面（#248）。

## Requirements

### 弹窗与快捷键

- R1: 侧栏搜索框保留为入口，点击/聚焦时打开搜索弹窗（输入框本身不再内联搜索）。
- R2: 全局快捷键 `Ctrl+K` / `Cmd+K` 唤起弹窗（preventDefault 拦截浏览器默认行为）；`Esc` 关闭弹窗。
- R3: 弹窗内为输入框 + 分组结果列表（话题组 / 消息组），复用现有 300ms debounce + `useSearch` 数据层与 `<mark>` 高亮；无结果显示空态文案。
- R4: 键盘可操作：↑/↓ 在扁平化结果序列（话题组在前、消息组在后）间移动，Enter 跳转选中项。
- R5: 选中结果后关闭弹窗，跳转对应话题并复用现有滚动定位 + 高亮（消息命中带 `?m=<groupId>`）。
- R6: 侧栏折叠为图标轨时，搜索图标按钮直接打开弹窗（不再展开侧栏）。
- R7: 弹窗在移动端可用（响应式宽度），所有触发入口不依赖 hover（#248）。
- R8: 移除内联搜索后，话题树始终常驻侧栏（不再被结果面板替换）。

### 话题内「下一条命中」导航

- R9: 从弹窗选中消息结果跳转时，将本次搜索结果中**同一话题**的全部消息命中（按 `createdAt` 正序，即最旧在前、与页面自上而下一致）作为命中队列随跳转传递；话题结果跳转不携带队列。
- R10: 跳转后聊天区域显示浮动控件：当前命中序号 / 总数（如 `2 / 5`）、上一条 ↑、下一条 ↓、关闭 ×；↑ 跳向页面更靠上（更旧）的命中、↓ 跳向更靠下（更新）的命中，与视觉方向一致；点击后滚动定位并闪烁高亮对应消息（复用 `scrollToMessage` + 2s 高亮）。
- R11: 浮动控件在切换话题、点击 × 后消失；命中已删除消息时滚动 no-op（沿用现有行为），不额外报错。
- R12: 跨话题的命中导航不做——查看其他话题的命中需重新打开弹窗选择。

## Acceptance Criteria

- [ ] AC1: 点击/聚焦侧栏搜索框 → 弹窗打开且输入框自动聚焦；侧栏树不被替换。
- [ ] AC2: 任意页面按 Ctrl+K（mac 上 Cmd+K）→ 弹窗打开；Esc 或点击遮罩 → 关闭。
- [ ] AC3: 弹窗内输入关键词 → 300ms debounce 后展示话题/消息分组结果；无结果时显示空态文案；关键词高亮与现状一致。
- [ ] AC4: ↑/↓ + Enter 可纯键盘完成「唤起 → 输入 → 选择 → 跳转」。
- [ ] AC5: 选中消息结果 → 弹窗关闭、跳转话题、目标消息滚动定位并闪烁高亮（行为与现网一致）。
- [ ] AC6: 图标轨状态点击搜索图标 → 直接开弹窗，侧栏保持折叠。
- [ ] AC7: 移动端（触摸）可完成同样流程，无 hover 依赖。
- [ ] AC8: 新增/更新的 l10n key（`Search.palette.*`）中英文齐全；`SidebarSearch.test.tsx` 等受影响测试更新并通过。
- [ ] AC9: 同话题多条命中时，跳转后浮动控件显示 `k / n`；↑/↓ 可在命中间往复定位，每次均有高亮闪烁。
- [ ] AC10: 浮动控件仅在当前话题有效：切换话题或点 × 后消失且不残留状态；刷新页面后不出现。
- [ ] AC11: 选中话题结果（非消息）跳转后不出现浮动控件。

## Out of Scope

- 搜索结果排序/分页/索引优化（独立优化项）。
- 弹窗空查询时展示「最近话题」等额外内容（默认空态，不做）。
- 跨话题的连续命中导航（R12）。
- 后端 `/api/search` 的任何改动。
