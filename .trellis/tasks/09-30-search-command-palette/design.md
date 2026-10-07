# Design: Search command palette modal

## Architecture & Boundaries

```
AppShell (client layout)
└─ <SearchDialog/>            ← 全局挂载，任何页面可用；内含 Ctrl/Cmd+K 监听
    │  open state: Zustand store useSearchDialogStore { open, setOpen }
    │  data: useDebouncedValue + useSearch（不改）
    │  select message hit → 写 sessionStorage 命中队列 → router.push(?m=...)
    │  select topic hit   → router.push(topic href)
    ▼
AssistantTree
└─ <SidebarSearch/>           ← 退化为入口：readOnly 输入框 onFocus/onClick → setOpen(true)
                                 图标轨按钮 → setOpen(true)（不再展开侧栏）
    （删除 SearchResults 面板；树常驻）
    ▼
ChatView (?m=<groupId> 深链 effect)
└─ 跳转成功后 consume sessionStorage 命中队列 → <SearchHitNav/> 浮动控件
```

- 弹窗开关是**客户端 UI 状态** → Zustand（遵循 state-management spec：server state 留在 TanStack Query，本任务不碰）。
- `<SearchDialog/>` 挂在 `AppShell` 内部（已是 client 组件），保证 AC2「任意页面」；不再只依赖侧栏存在。
- 命中队列属一次性跳转载荷，不属于 React 状态树 → **sessionStorage**（key `pika:search-hit-queue`），写入方 SearchDialog、消费方 ChatView，消费即删。刷新后 `?m` 已被剥离，控件自然不出现（AC10）。

## Data Flow & Contracts

### 命中队列载荷（sessionStorage `pika:search-hit-queue`）

```ts
type SearchHitQueue = {
  topicId: string;
  /** 同话题消息命中的 groupId，按 createdAt 正序（最旧在前）。API 返回
   *  desc，写入时 reverse——正序与页面自上而下一致，↑/↓ 才符合视觉方向
   *  （倒序会让 ↑ 跳向页面下方），k/n 计数也与 find-in-page 语义一致。 */
  hits: string[];
  /** 触发本次跳转的 groupId，用于定位初始 index */
  current: string;
};
```

- SearchDialog 选中消息命中时：从当前结果 `messages` 中过滤 `topicId === hit.topicId`，映射 `groupId` 得 `hits`；`hits.length >= 2` 才写入（单命中无需导航控件，少一步 DOM）。
- ChatView 的 `?m` effect 在成功触发 scrollToMessage 的同一分支读取并删除该 key；校验 `topicId === activeTopicId && hits.includes(targetMessageKey)`，不满足则丢弃。

### SearchHitNav 控件

- ChatView 本地 state：`hitNav: { hits: string[]; index: number } | null`。
- ↑/↓：index ±1（clamp 到 `[0, hits.length-1]`，不循环），`scrollToMessage(hits[i])` + 2s 高亮闪烁（把现有 `setHighlightKey + setTimeout` 抽成 `flashMessage(key)` 供深链 effect 与控件共用）。
- 消失条件：点 ×、`activeTopicId` 变化。
- 定位：消息区右下浮动（`absolute bottom-20 right-4`），定位祖先为 ChatView 内包裹 `MessageList` 的 `relative` 消息区容器——不是包含 Composer 的外层容器（`bottom-20` 对外层会落进 Composer 高度带）。与 scroll-to-bottom 按钮（消息区 bottom-4）垂直分离。常驻显示，不依赖 hover（#248）。
- 删除的命中：`scrollToMessage` 本就 no-op，不特殊处理（R11）。

### 弹窗内部

- 复用 `Dialog`（Base UI），内容：输入框（autoFocus）+ 结果区。
- 结果扁平序列 `[...topics, ...messages]` 上维护 `activeIndex`（默认 0，随结果集变化重置/clamp）；↑/↓ 移动、Enter 触发选择；鼠标点击直接选择。滚动容器用现有 `thin-scrollbar`。
- 结果项与高亮：把 `HighlightedText`/`HighlightedTitle`/`messageHitHref` 从 `SearchResults.tsx` 迁入 `SearchDialog.tsx`（`SearchResults.tsx` 删除，无第二个使用者）。
- 移动端：Dialog 内容 `w-[calc(100vw-2rem)] max-w-lg`，顶部对齐（`top-[15%]` 风格），输入即搜，无需额外全屏 sheet。
- Ctrl/Cmd+K 监听：`window.keydown`，`(e.metaKey || e.ctrlKey) && e.key === "k"` → `preventDefault()` + `setOpen(true)`（已开则聚焦输入框）。与 sidebar 的 Ctrl+B 同模式。
- 图标轨按钮：现逻辑是「展开侧栏 + 聚焦输入」，改为直接 `setOpen(true)`，删掉 `focusOnExpandRef` 逻辑。
- **焦点契约（浏览器实测修复）**：入口框 onFocus 打开弹窗时，DialogContent 必须 `finalFocus={false}`——否则关闭后 Base UI 焦点回落到入口框再次触发 onFocus 重开（遮罩/Esc/选中结果都无法关闭）；入口框还需 `onMouseDown preventDefault`，让鼠标路径在 click 完成后才打开，避免弹窗刚挂上的 outside-press 监听把同一次 click 当作遮罩点击关（打开闪一下的 bug）。

## i18n

- 复用 `Search.sidebar.*` 中语义不变的 key：`placeholder` / `searching` / `noResults` / `topicsGroup` / `messagesGroup`。
- 新增 `Search.palette.*`：`openSearch`（入口 aria-label 迁过来）、`prevHit`、`nextHit`、`closeNav`、`hitIndicator`（`{current} / {total}` 无文案则直接用数字，优先不加 key——实现时若需要 aria-label 文案再加）。
- en / zh-CN 两个 catalog 同步更新。

## Trade-offs

- **sessionStorage vs URL 参数传命中队列**：URL 会让队列泄漏到分享链接且需清理一长串参数；sessionStorage 一次性、免清理，代价是跨标签页不共享——搜索跳转本就同标签页操作，可接受。
- **全局挂载弹窗 vs 侧栏内挂载**：侧栏在设置页等路由不一定渲染，AC2 要求任意页面可唤起 → 挂 AppShell，代价是 open state 需要跨组件（Zustand 一个小 store）。
- **不循环的 ↑/↓**：循环导航对「第 k/n 条」语义有干扰，clamp 更直观。

## Compatibility & Rollback

- 纯前端改动；`/api/search`、schema、深链参数格式均不变。
- 回滚 = revert 单 commit：恢复 `SearchResults.tsx` 与 `SidebarSearch` 内联模式即可，无数据迁移。
- 受影响测试：`src/components/assistant/SidebarSearch.test.tsx`（内联搜索用例需重写为弹窗用例）；新增 `SearchDialog.test.tsx`、hit-nav 相关用例。

## Risks

- ChatView 的 `?m` effect 已是时序敏感区（rAF + 消费守卫），hit-nav 读取必须挂在「确认跳转」分支之后，避免空话题/未加载分支误消费队列。
- Base UI Dialog 的 focus 管理：打开后需确认输入框 autoFocus 生效（Base UI Dialog 默认聚焦第一个可聚焦元素，输入框放首位即可）。
