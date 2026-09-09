# Implement — 对话消息区域导航与定位

> 顺序执行。前置阅读：`prd.md` → `design.md` → `.trellis/spec/frontend/chat-scroll-behavior.md`（可执行规约，动了 `MessageList.tsx` 就受它约束）。

---

## Checklist

### 1. 锚点（`src/components/chat/MessageItem.tsx`）

- [ ] props 只加 `itemKey?: string`（由父下发，组件自己**不**算 `groupId ?? id`）。
- [ ] 两个 `<article>` 分支（user `:238-256`、assistant `:261-268`）都加 `data-message-key={itemKey}`。
- [ ] **不做跳后高亮**：不要加 `highlighted` prop / `data-highlighted` / ring class（原 R5.4 已按用户反馈移除，见 design.md §5）。

> 检查点：`pnpm typecheck`。两个分支都要改，只改一个会让用户消息没有锚点，跳转静默失效。

### 2. `MessageList`（`src/components/chat/MessageList.tsx`）

- [ ] 导出 `type MessageListHandle = { scrollToBottom: () => void; scrollToMessage: (key: string) => void }`；props 增加 `ref?: Ref<MessageListHandle>`（React 19 直接收 ref prop，不需要 `forwardRef`）。
- [ ] 新增 state：`atBottom`（默认 `true`）；新增 ref：`bottomPendingRef`（平滑"回到底部"飞行期间保持按钮隐藏，否则中途的 scroll 事件会把按钮闪回来）。
- [ ] 根节点改为 `relative flex min-h-0 flex-1 flex-col` 包裹层，原滚动容器收进内部并保留原有 class；**`flex-1` / `min-h-0` 移到外层**，否则消息区高度会塌。
- [ ] 抽一个 `syncAtBottom()`（`distance = scrollHeight - scrollTop - clientHeight < 32`），在 `handleScroll`（`:216`）末尾和 ResizeObserver 回调（`:202-206`）里各调一次。
- [ ] 加一个模块级 helper `scrollToPosition(container, top)`：夹到 `[0, scrollHeight - clientHeight]` + `prefers-reduced-motion` 时 `behavior: "auto"`、否则 `"smooth"`。`scrollToBottom` 与 `scrollToMessage` 共用，别把这段写两遍。
- [ ] 实现 `scrollToMessage(key)`：摘 pin → 找元素（`querySelectorAll("[data-message-key]")` + `dataset.messageKey === key`，**不要拼属性选择器**）→ 算 `top`（目标 top − 容器 top + scrollTop − 16）→ 交给 `scrollToPosition`。**不要加高亮**（R5.4 已移除）；目标不存在时（消息在浮层打开期间被删）直接 return。
- [ ] 实现 `scrollToBottom()`：`pinnedRef.current = true` → `bottomPendingRef.current = true` + `setAtBottom(true)` → `scrollToPosition(container, container.scrollHeight)`。
- [ ] `useImperativeHandle(ref, …)` 暴露这两个方法。
- [ ] `messages.map` 里给 `MessageItem` 传 `itemKey={itemKey}`。
- [ ] 包裹层内、`!atBottom` 时渲染滚动到底部按钮：外层 `pointer-events-none absolute inset-x-0 bottom-4 px-4` + 内层 `mx-auto flex w-full max-w-[52.5rem] justify-end`，按钮自身 `pointer-events-auto`、`size="icon-lg"`、`variant="secondary" rounded-full`、`aria-label="Scroll to latest"`、`ArrowDownIcon`（`className="size-5"`）。对齐到消息内容列右边缘，不是视口右边缘。

> 检查点：`pnpm lint && pnpm typecheck`。这是唯一会碰到既有滚动契约的文件——不要改 `handleScroll` 里 pin 的释放条件，也不要改 ResizeObserver 的跟随条件。

### 3. 新组件 `src/components/chat/ChatMapDialog.tsx`

- [ ] props：`{ open; onOpenChange; messages: ChatUIMessage[]; onSelect: (key: string) => void }`，`"use client"`，默认导出，文件名与组件名一致。
- [ ] `Dialog` + `DialogContent`（className 覆盖 `sm:max-w-lg`，加 `flex max-h-[70vh] flex-col`）+ `DialogHeader` / `DialogTitle`（"Chat map"）。
- [ ] 列表 `<ul className="thin-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">`；每行是 `<li><button type="button" onClick={() => onSelect(key)}>`，文本节点 `block max-w-[85%] truncate rounded-lg px-3 py-2 text-sm`；用户 → `justify-end` + `bg-muted` 填充 + `font-medium`，AI → `justify-start` + `border border-border` 描边无填充 + `font-normal`（对齐 / 填充 vs 描边 / 字重三重区分）。
- [ ] 行文案：text parts 拼接 → `trim()` → 连续空白折叠为单空格；为空时渲染 muted `"No text"`。
- [ ] 行 key 用 `message.metadata?.groupId ?? message.id`，与消息区同粒度。

> 检查点：`pnpm lint`（`jsx-a11y` + `react-hooks`）。行必须是 `<button>`，不能是 `div onClick`。

### 4. `Composer`（`src/components/chat/Composer.tsx`）

- [ ] props 新增 `onOpenChatMap: () => void`（必需：Composer 只有一个宿主，不做可选分支）与 `chatMapDisabled?: boolean`。
- [ ] 右组（`:171-209`）**最前面**（展开/收起按钮之前）插入图标按钮，使顺序为 `聊天地图 → 展开/收起 → 发送/停止`；展开/收起保持紧邻发送按钮左侧，不移动。按钮：`type="button"`（**Composer 根是 `<form>`，缺省 type 会变成 submit**）、`variant="ghost" size="icon-sm"`（与 Composer 里其他图标一致）、`aria-label="Chat map"`、`disabled={chatMapDisabled}`、`MapIcon`。

> 检查点：`pnpm typecheck`。按钮顺序：地图 → 展开/收起 → 发送/停止。

### 5. `ChatView`（`src/components/chat/ChatView.tsx`）

- [ ] `const messageListRef = useRef<MessageListHandle>(null)`；`const [chatMapOpen, setChatMapOpen] = useState(false)`。
- [ ] `<MessageList ref={messageListRef} … />`（`:834-849`）。
- [ ] `handleSelectMessage(key)`：`setChatMapOpen(false)` → `requestAnimationFrame(() => messageListRef.current?.scrollToMessage(key))`。
- [ ] 渲染 `<ChatMapDialog open={chatMapOpen} onOpenChange={setChatMapOpen} messages={messages} onSelect={handleSelectMessage} />`。
- [ ] `<Composer onOpenChatMap={() => setChatMapOpen(true)} chatMapDisabled={messages.length === 0} … />`（`:866-…`）。

### 6. 测试

- [ ] `MessageList.test.tsx`：
  - 每条消息渲染出 `data-message-key`，取值 `groupId ?? id`（用 `assistantMessage("v1", …, "group-1")` 造数据，切到 `v2` 后 key 不变）；
  - 初始无滚动到底部按钮；`fireEvent.scroll` 配合伪造的 `scrollTop` / `scrollHeight` / `clientHeight`（写法参考 `ReasoningBlock.test.tsx:10-30`）让 `distance > 32` 后按钮出现；点击后按钮消失；
  - 通过 ref 调 `scrollToMessage("group-1")`：断言滚动被调用且 `top` 计算正确（stub `getBoundingClientRect`）；跳转不存在的 key 不抛错。
  - 需要 stub：`Element.prototype.scrollTo`（jsdom 未实现）、`window.matchMedia`。
- [ ] 新增 `ChatMapDialog.test.tsx`：每个渲染条目一行；点击某行用对应 key 调 `onSelect`。
- [ ] `Composer.test.tsx`：地图按钮 `type="button"`、`chatMapDisabled` 时禁用、点击触发 `onOpenChatMap`。

### 7. 校验

```bash
pnpm lint
pnpm typecheck
pnpm test
```

三个都必须绿（`.trellis/spec/frontend/quality-guidelines.md:7-15`）。

### 8. 浏览器回归（jsdom 测不出来的部分）

按 `.trellis/spec/frontend/chat-scroll-behavior.md` 的 Verification 要求实测：

- [ ] 滚离底部 → 按钮出现；回到底部 → 按钮消失；流式输出中点击后继续跟随。
- [ ] **跳转到中间的消息后停留 5s 不被拽回底部**（含异步 mermaid / 图片渲染的场景）—— 摘 pin 是否生效的唯一可靠验证。
- [ ] 跳后 ring 出现并淡出，落地时消息不跳动。
- [ ] 关闭浮层与滚动的时序：若滚动在 Dialog 退场动画期间被干扰，改用 Base UI 的 `onOpenChangeComplete` 或双 rAF。
- [ ] 移动断点：Composer 右组三个图标不挤，浮层可用。

### 9. 收尾（Phase 3.3）

本次会产生值得写进 `.trellis/spec/` 的知识：**"跳转/定位类操作必须先摘 pin"**（这是既有规约里没有的一条，属于踩坑型知识）。在提交前用 `trellis-update-spec` 把它补进 `.trellis/spec/frontend/chat-scroll-behavior.md`。

---

## 高风险文件

| 文件 | 风险 |
|---|---|
| `src/components/chat/MessageList.tsx` | 唯一触及既有滚动契约的文件；改错 pin 条件会让整条自动滚动链失效 |
| `src/components/chat/ChatView.tsx` | 组件大（880+ 行）、接线点多，容易漏传 prop |
| `src/components/chat/Composer.tsx` | `<form>` 内的按钮缺省 type 是 submit |

## 回滚点

- 第 1–2 步完成后可独立验证（锚点 + 回底按钮可用，地图还没接）；出问题 revert 到这一步之前。
- 第 3–5 步是纯增量（新组件 + 两处接线），不触及既有滚动逻辑。
- 全部改动都是新增 UI，无数据/接口/持久化变更，回滚 = revert 提交。
