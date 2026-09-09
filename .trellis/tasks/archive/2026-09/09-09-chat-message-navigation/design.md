# Design — 对话消息区域导航与定位

> 对应 `.trellis/tasks/09-09-chat-message-navigation/prd.md`。范围：滚动到底部按钮 + 聊天地图浮层（PRD R1–R5）。

---

## 1. 组件边界与状态归属

```
ChatView                                  (owns: messages, chatMapOpen, messageListRef)
├── MessageList  ref={messageListRef}     (owns: 滚动容器、pin、锚点、atBottom、bottomPendingRef)
│   ├── 滚动容器 div  (既有)
│   │   └── MessageItem  × N             (新增 data-message-key)
│   └── 滚动到底部 Button                 (新增，内联在包裹层里，对齐内容列右边缘)
├── ChatMapDialog                        (新增，纯展示 + Dialog；由 ChatView 渲染)
└── Composer  onOpenChatMap / chatMapDisabled   (新增一个图标按钮)
```

（滚动到底部按钮没有单独抽组件 —— 它只有一个使用点、只依赖 `atBottom`，内联在 `MessageList` 的包裹层里比多一个文件更清楚。）

**归属原则**：任何依赖滚动位置的状态都留在 `MessageList` 里，不外泄。`ChatView` 只拿到一个命令式句柄，不读 `scrollTop`、不自己算位置。理由：滚动契约全部固化在 `.trellis/spec/frontend/chat-scroll-behavior.md`，把滚动知识摊到 `ChatView` 会让那份规约失效。

**为什么聊天地图按钮在 Composer、而浮层由 ChatView 渲染**：按钮必须落在 Composer 的右组内部（`Composer.tsx:171-209` 的 flex 行里），但浮层需要 `messages`，而 Composer 不持有它。把 `messages` 传进 Composer 会把表单组件和数据耦合起来，所以 Composer 只拿回调，浮层留在 ChatView。

---

## 2. 锚点契约（R4）

- `MessageList` 已经算出 `itemKey = message.metadata?.groupId ?? message.id`（`MessageList.tsx:323`）用于 React key。新增 prop `itemKey: string` 传给 `MessageItem`，渲染成 `<article data-message-key={itemKey}>`。
- **粒度必须与 React key 一致**（version group，不是 per-version id）。切换版本会在同组里换进一个不同 id 的行，若用裸 id 做锚点，切换后锚点指向的行已经不渲染了，跳转会静默失败。
- 查找元素时**不要用 `[data-message-key="…"]` 选择器**：id 是任意字符串，拼进选择器有转义风险。改为：

  ```ts
  const el = Array.from(
    container.querySelectorAll<HTMLElement>("[data-message-key]"),
  ).find((node) => node.dataset.messageKey === key);
  ```

---

## 3. MessageList 的命令式句柄

React 19 里函数组件可以直接收 `ref` prop，不需要 `forwardRef`。

```ts
export type MessageListHandle = {
  scrollToBottom: () => void;
  scrollToMessage: (key: string) => void;
};
```

`MessageList` props 增加 `ref?: Ref<MessageListHandle>`，内部 `useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage])`（两者都是 `useCallback(…, [])`，句柄实际稳定）。

两个方法共用一个模块级 helper，避免"夹取 + 尊重 reduced-motion"这段逻辑写两遍：

```ts
function scrollToPosition(container: HTMLDivElement, top: number) {
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTo({
    top: Math.min(Math.max(0, top), max),
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}
```

### `scrollToMessage(key)`

1. **`pinnedRef.current = false`** —— 必须在滚动前。跟随条件是 `pinned && (tailStreaming || sendTurnActive || !streaming)`（`MessageList.tsx:203-205`），空闲时 `!streaming` 为真，pin 挂着的话任何异步内容（mermaid / 图片 / 公式）长高都会被 ResizeObserver 拽回底部，跳转等于白跳。这是本次改动与既有规约的**唯一硬耦合点**。
2. 按第 2 节找到元素；找不到直接返回（消息可能在浮层打开期间被删掉）。
3. `top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16`。16px 与发送定位的 `MessageList.tsx:165` 保持一致。
4. 交给 `scrollToPosition`（夹到 `[0, scrollHeight - clientHeight]`，`prefers-reduced-motion: reduce` 时用 `auto` 而非 `smooth`）。

**落地不做任何高亮** —— 见第 5 节。

### `scrollToBottom()`

1. `pinnedRef.current = true`（"回到最新"的语义就是重新跟随）。
2. `bottomPendingRef.current = true` + `setAtBottom(true)`（原因见第 4 节）。
3. `scrollToPosition(container, container.scrollHeight)` —— 夹到 max 与浏览器对未夹取值的行为一致。

> 已知取舍：如果在流式输出进行中回到底部，ResizeObserver 会在每次内容长高时写 `scrollTop = scrollHeight`，可能让平滑滚动提前"吸附"到底。此时吸附到底本来就是用户想要的，不特殊处理。

---

## 4. atBottom 与滚动到底部按钮（R1）

- `MessageList` 新增 state `atBottom`，默认 `true`。
- 在 `handleScroll` 末尾同步：`atBottom = scrollHeight - top - clientHeight < 32`。32px 与既有重新挂 pin 的阈值（`MessageList.tsx:263`）取同一个数，避免"pin 已挂但按钮还亮着"这种自相矛盾的状态。
- 同一个同步也放在 ResizeObserver 回调里：内容变高/变矮不一定触发 scroll 事件（例如删除一条消息），只在 `handleScroll` 里算会留下过期状态。`setState` 传同一个值时 React 会 bail out，不会造成额外渲染。
- 按钮仅在 `!atBottom` 时渲染。
- **`bottomPendingRef`**：点"回到底部"后，平滑滚动是逐帧走的，途中每个 scroll 事件测到的距离仍然是 800，只靠实测距离会让按钮在整段动画里闪回来。所以飞行期间置起该标志，`syncAtBottom` 保持 `atBottom = true`，直到距离真正 `< 32`（落地）或用户用 wheel/touch 接管（`handleWheel` / `handleTouchMove` 里清标志 —— 浏览器会在用户输入时取消程序化平滑滚动）。

### 布局

`MessageList` 根节点现在是滚动容器本身（没有定位父级）。改为：

```tsx
<div className="relative flex min-h-0 flex-1 flex-col">
  <div ref={containerRef} … className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
    …
  </div>
  {!atBottom ? <滚动到底部 Button … /> : null}
</div>
```

按钮对齐到消息内容列，不贴视口边缘 —— 消息内容是 `mx-auto w-full max-w-[52.5rem]`（外层滚动容器带 `px-4 py-4`），宽屏下贴视口右边会离消息很远：

```tsx
// 覆盖层铺满消息区但不吃点击；内层镜像内容列宽度
<div className="pointer-events-none absolute inset-x-0 bottom-4 px-4">
  <div className="mx-auto flex w-full max-w-[52.5rem] justify-end">
    <Button className="pointer-events-auto …" … />
  </div>
</div>
```

按钮 `size="icon-lg"`（36px，比行内图标大一圈，因为它是浮在内容之上的悬浮按钮）、`variant="secondary"`、`rounded-full`、`aria-label="Scroll to latest"`、图标 `ArrowDownIcon` + `className="size-5"`。外层 `pointer-events-none` 是**必需**的：整条覆盖层铺在消息之上，否则会吃掉消息区的点击、破坏既有的 tap-to-reveal（`component-guidelines.md:266-279`）。`messages.length === 0` 时 `MessageList` 仍然提前 return（`MessageList.tsx:291-299`），不会有按钮。

> 注意 `flex-1` / `min-h-0` 要从滚动容器移到新的外层包裹上，否则消息区高度会塌。

---

## 5. 跳后不做高亮

**跳后高亮（R5.4）已移除** —— 用户看过实际效果后判定不好看。原方案是在 `<article>` 上挂 `data-highlighted` + `ring-2 ring-ring`，但消息 `<article>` 是全宽块级元素，ring 视觉上像一条横贯的色带，而不是"高亮某条消息"。

移除后：`MessageItem` **不收** `highlighted` prop，`MessageList` **没有** `highlightKey` state 与定时器，`scrollToMessage` 只做摘 pin → 定位 → 滚动。滚动位置本身即反馈（浮层已在跳转前关闭，目标就在视口顶部）。

> 如果将来要重新引入落点反馈，别再用全宽 ring：考虑只在消息气泡（用户气泡 / 助手首段）上加短暂背景色，或给容器加一次性闪烁，先做视觉稿再实现。

---

## 6. 聊天地图浮层（R3）

新文件 `src/components/chat/ChatMapDialog.tsx`：

```ts
type ChatMapDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatUIMessage[];
  onSelect: (key: string) => void;
};
```

- 复用 `ui/dialog.tsx`：`Dialog` + `DialogContent` + `DialogHeader` / `DialogTitle`（"Chat map"）。
- `DialogContent` 的 className 覆盖为 `sm:max-w-lg`，并加 `flex max-h-[70vh] flex-col`（默认 `sm:max-w-sm` 太窄；`grid` → `flex` 由 `cn`/twMerge 的 display 冲突合并处理，`max-h` + `flex-col` 才能让内部列表 `min-h-0 flex-1 overflow-y-auto` 真正滚动）。
- 列表：`<ul className="thin-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">`，每行是 `<li><button type="button" onClick={() => onSelect(key)}>` 包一个气泡 `<span>`。整行是 `<button>`（可 Tab 聚焦、Enter 触发；不是 `div onClick`）；气泡 `block max-w-[85%] truncate`，`truncate` 负责单行截断。
- 气泡样式（`text-sm` + `px-3 py-2`；`text-xs` 实测偏小）：

  | | 对齐 | 填充 | 字重 |
  |---|---|---|---|
  | 用户 | `justify-end` | `bg-muted`（填充） | `font-medium` |
  | AI | `justify-start` | `border border-border`（描边，无填充） | `font-normal` |

  三个信号叠加才够明显 —— 只靠对齐 + 两种相近浅色气泡时，用户反馈"区分不明显"。
- 行文案：取 text parts 拼接后 `trim()`、把连续空白折叠成单个空格；为空（纯工具调用 / 纯推理）时渲染 muted 的 `"No text"`。
- 列表粒度 = 当前渲染的每条消息，一个版本组只列当前显示的那个版本（与第 2 节同粒度）。
- 不做当前位置高亮、不做搜索框（PRD Out of Scope）。

---

## 7. Composer 与 ChatView 的接线（R2 / R5.1）

**Composer** 新增 `onOpenChatMap: () => void`（必需 —— Composer 只有一个宿主，不存在"没有消息列表可跳"的场景，不做可选分支）与 `chatMapDisabled?: boolean`。按钮插在右组（`Composer.tsx:171-209`）**最前面**，即展开/收起之前 —— 展开/收起保持紧邻发送按钮左侧，右组最终顺序为：

```
[ 聊天地图 ] [ 展开/收起 ] [ 发送 / 停止 ]
```

（展开/收起是条件渲染的：只有 `expanded || overflowsCollapsed` 为真的草稿才出现，所以实际常见形态是 `[ 地图 ] [ 发送 ]`。）

```tsx
<Button
  type="button"                       // 必须：Composer 根是 <form>，缺省 type 会变成 submit
  variant="ghost"
  size="icon-sm"                      // 与 Composer 里其他图标（各 picker 触发器、发送按钮）一致
  aria-label="Chat map"
  disabled={chatMapDisabled}
  onClick={onOpenChatMap}
>
  <MapIcon aria-hidden="true" />
</Button>
```

图标按钮只给 `aria-label`，不挂 Tooltip —— chat 组件里目前没有任何 Tooltip 用法，保持一致。空会话（`messages.length === 0`）时 `chatMapDisabled` 为真。

**ChatView**：

```tsx
const messageListRef = useRef<MessageListHandle>(null);
const [chatMapOpen, setChatMapOpen] = useState(false);

function handleSelectMessage(key: string) {
  setChatMapOpen(false);
  requestAnimationFrame(() => messageListRef.current?.scrollToMessage(key));
}
```

- **先关闭、后滚动**（R5.1）：`setChatMapOpen(false)` 与滚动放在同一个 handler，滚动推到下一帧执行，避开 Dialog 退场动画期间的布局/滚动锁定。
- 浮层由 ChatView 渲染：`<ChatMapDialog open={chatMapOpen} onOpenChange={setChatMapOpen} messages={messages} onSelect={handleSelectMessage} />`。
- Composer 传 `onOpenChatMap={() => setChatMapOpen(true)}` 与 `chatMapDisabled={messages.length === 0}`。

---

## 8. 兼容性与风险

| 风险 | 处理 |
|---|---|
| 跳转后异步内容长高把视图拽回底部 | 跳转前摘 pin（第 3 节）。这是最容易回归的点，验收里单列一条。 |
| `handleScroll` 里新增 `setAtBottom` 让滚动变卡 | 同值 setState 会被 React bail out；只在布尔翻转时渲染。 |
| 锚点粒度用错（裸 id 而非 groupId） | 由 `MessageList` 单点下发 `itemKey`，`MessageItem` 不自己算。 |
| jsdom 没有 `Element.prototype.scrollTo` / `window.matchMedia` | 测试里 stub（不往产品代码加 shim）。 |
| Dialog 退场动画未结束就滚动 | 用 rAF 推迟一帧；浏览器回归时若仍被动画干扰，改用 Base UI 的 `onOpenChangeComplete` 或双 rAF。 |
| 移动端 Composer 右组变挤 | 右组目前最多三个图标（地图 + 展开 + 发送），地图与发送都是 `icon-sm`（28px）、展开是 `icon-xs`；需在窄屏实测。 |

**回滚**：纯新增 UI，无数据/持久化/接口变更，回滚 = revert 提交，无迁移。

---

## 9. 测试策略

- `MessageList.test.tsx`（已有，沿用它对 `streamdown` / `./markdown-plugins` / ResizeObserver 的 mock）：
  - 每条消息都渲染出 `data-message-key`，取值是 `groupId ?? id`；
  - 初始不渲染滚动到底部按钮；构造"已滚离底部"的 scroll 事件后按钮出现；点击后容器 `scrollTo` 收到夹过的 `scrollHeight - clientHeight`，且飞行途中按钮不闪回（`bottomPendingRef`）；
  - 通过 ref 调 `scrollToMessage(key)`：stub `getBoundingClientRect` 后断言 `scrollTo` 的 `top`（含超出可滚范围时夹到 max）；跳一个不存在的 key 不抛错；
  - **跳转先摘 pin**：用假 ResizeObserver 捕获回调，跳转后驱动回调，断言 `scrollTop` 没有被写回 `scrollHeight`。这条是 `chat-scroll-behavior.md` 里"跳转必须先摘 pin"的守护，不能删。
- `ChatMapDialog.test.tsx`（新增）：每个渲染条目一行；点击某一行用对应 key 调 `onSelect`。
- `Composer.test.tsx`（已有）：地图按钮 `type="button"`、`chatMapDisabled` 时禁用、点击触发 `onOpenChatMap`。
- 滚动交互与时序在 jsdom 下测不出来，按 `.trellis/spec/frontend/chat-scroll-behavior.md` 的 Verification 要求在真实浏览器补验。
