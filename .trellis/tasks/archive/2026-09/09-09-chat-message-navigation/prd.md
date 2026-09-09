# 优化对话消息区域导航与定位

## Goal

长对话里用户会滚到很靠上的位置，而当前消息区没有任何"回到最新"或"跳到某条消息"的手段，只能手动滚。本次补两件事：一个**滚动到底部按钮**，以及一个**聊天地图**（按钮唤起的浮层概览列表，列出全部消息，点击跳转）。

用户价值：在几十上百条的会话里，一键回到最新，或一步跳到任意一条历史消息，并且跳过去之后知道落在了哪一条。

## Background / Confirmed Facts

以下均由仓库勘察确认（非待定项，实现前不必再问）：

**滚动容器与既有机制**

- 滚动容器是 `src/components/chat/MessageList.tsx:301-309` 的内层 `div`（`thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4`）。窗口本身不滚动：`src/components/chat/AppShell.tsx:27-33` 把外壳钉成 `h-svh overflow-hidden`。
- 已存在完整的自动滚动机制：话题进入置底 `MessageList.tsx:120-135`、发送定位 `:142-178`、ResizeObserver 跟随输出 `:196-209`、pin 的释放与重挂（`handleScroll` `:216-267`、wheel `:271-275`、touch `:277-289`）。契约固化在 `.trellis/spec/frontend/chat-scroll-behavior.md`（可执行规约，改 `MessageList.tsx` 前必读）。
- **派生风险**：`ResizeObserver` 的跟随条件是 `pinned && (tailStreaming || sendTurnActive || !streaming)`（`MessageList.tsx:203-205`）。空闲时 `!streaming` 为真，所以**只要 pin 还挂着，任何异步内容（mermaid、图片、公式）长高都会把视图拽回底部**。跳转必须先摘掉 pin，否则跳到中间会被拽回去。

**缺失的基础设施**

- **当前不存在**任何滚动到底部按钮、悬浮按钮、跳转控件、消息搜索、目录或锚点。只有消息内版本切换（`src/components/chat/MessageActions.tsx:95-151`，接线于 `ChatView.tsx:685-705`）。
- **消息节点上没有 `id` / `data-message-id` / 锚点属性**。`src/components/chat/MessageItem.tsx:238-256`（user `<article>`）与 `:261-268`（assistant `<article>`）只有 `aria-label`（"You" / "Assistant"）和 `data-revealed`。跳转必须先加锚点。
- 滚动容器**外没有 `relative` 包裹层**（`ChatView.tsx:834-850`、`MessageList.tsx:301`），悬浮按钮需要定位父级。
- React key 与 reveal 状态用 `message.metadata?.groupId ?? message.id`（`MessageList.tsx:323`），不是裸 id —— 切换版本会在同组里换进一个不同 id 的行。地图锚点必须沿用同一粒度的 key，否则版本切换会让锚点错位。

**栈与约定**

- Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui（底层 Base UI，style `base-nova`）。`src/components/ui/dialog.tsx:42-81` 是现成 Dialog（`DialogContent` 默认 `sm:max-w-sm`，`fixed` 居中，可传 `className` 覆盖）。
- Base UI 弹层必须 `positionMethod="fixed"`（`.trellis/spec/frontend/component-guidelines.md:164-191`）；`ui/dialog.tsx` 的 Popup 本身已是 `fixed`。
- 图标按钮 + `aria-label` 是既有约定（`component-guidelines.md:108-117`）；pointer cursor 由 `globals.css` 的 `@layer base` 统一给（`component-guidelines.md:195-222`），新按钮不用自己加 `cursor-pointer`。
- **无虚拟化**（`package.json` 与源码里都没有 react-virtuoso / react-window / react-virtual），消息全量渲染 → 地图可以按真实 DOM 位置映射，但高度动态（markdown / mermaid / 图片），跳转必须实测元素位置，不能按条数估算。
- **无 i18n**，UI 文案硬编码英文（如 `MessageList.tsx:295`）。直接加英文。
- 测试：Vitest 4，三个 project（`vitest.config.mts:16-52`）。`src/components/chat/MessageList.test.tsx` 是现成模板（mock 了 `streamdown` 与 `./markdown-plugins`）；`ReasoningBlock.test.tsx:10-30` 有伪造 `scrollTop` 的写法可复用。校验命令 `pnpm lint` / `pnpm typecheck` / `pnpm test`（`.trellis/spec/frontend/quality-guidelines.md:7-15`）。

**Composer 按钮位**（`src/components/chat/Composer.tsx:171-209`）

- 右组现有：展开/收起按钮（`:172-186`，条件渲染）+ 发送/停止按钮（`:187-208`，`Send` 与 `Stop` 二选一）。左组是 AssistantPicker / ModelPicker / SearchModePicker / ReasoningEffort（`:147-170`）。地图按钮插在右组：展开/收起之后、发送/停止之前。

## Requirements

### R1 滚动到底部按钮

- R1.1 消息区底部悬浮一个图标按钮（Composer 上方），**仅在视图不在底部时出现**；横向对齐到消息内容列的右边缘，而不是消息区/视口的右边缘 —— 宽屏下内容列是 `max-w-[52.5rem]` 居中的，贴视口边缘会离消息很远。
- R1.2 点击 → 平滑滚动到消息区底部，并重新挂上跟随 pin（语义等同"回到最新"）。
- R1.3 按钮尺寸 `icon-lg`（36px），比行内图标大一圈（它是浮在内容之上的悬浮按钮）；带 `aria-label`；不遮挡最后一条消息；外层覆盖层必须 `pointer-events-none`，否则会吃掉消息区的点击、破坏既有的 tap-to-reveal。

### R2 聊天地图入口按钮

- R2.1 Composer 右组内新增一个图标按钮，排在**展开/收起按钮之前**；右组顺序为：聊天地图 → 展开/收起 → 发送/停止（展开/收起仍紧邻发送按钮左侧）。按钮尺寸 `icon-sm`，与 Composer 里其他图标（各 picker 触发器、发送按钮）一致。
- R2.2 点击 → 打开聊天地图浮层。
- R2.3 无消息时按钮禁用（空会话没有可跳转对象）。

### R3 聊天地图浮层

- R3.1 居中模态浮层（`ui/dialog.tsx`），标题 Chat map；最大高度约 70vh，列表内部滚动。
- R3.2 列表按消息区渲染顺序逐条列出**全部消息**（用户提问与 AI 回答都列），每条是一行气泡、超长单行截断；气泡字号 `text-sm`、内距 `px-3 py-2`（`text-xs` + `py-1.5` 实测偏小、行挤）。
- R3.3 用户消息与 AI 回答要一眼可分辨，靠**三个信号叠加**：对齐（用户右 / AI 左）+ 填充 vs 描边（用户 `bg-muted` 填充，AI `border border-border` 无填充）+ 字重（用户 `font-medium`）。只用对齐 + 相近浅色气泡时区分不明显。
- R3.4 每行是一个可键盘聚焦的按钮，整行可点。
- R3.5 列表粒度与消息区渲染一致：一个版本组只列当前显示的那个版本（与 `MessageList.tsx:323` 的 key 粒度相同）。
- R3.6 浮层不追踪、不高亮"当前视口所在位置"，打开时从对话开头开始展示。

### R4 消息锚点（R5 的前置基础设施）

- R4.1 每个消息的 `<article>` 带上稳定锚点属性，取值与 React key 同粒度（`groupId ?? id`），由 `MessageList` 统一下发。
- R4.2 版本切换 / 删除 / 重新生成后，锚点在仍然渲染的行上保持稳定，不因 id 变化而错位。

### R5 跳转行为与跳后反馈

- R5.1 点击浮层中某条 → **先关闭浮层**，再滚动到该消息。
- R5.2 目标消息对齐到滚动容器视口顶部（留约 16px，与 `MessageList.tsx:165` 的发送定位一致）。
- R5.3 滚动是平滑的（`behavior: "smooth"`）。
- R5.4 ~~跳后高亮~~ —— **已移除**：用户看过实际效果后判定 ring 不好看，跳转落地不做任何高亮，滚动位置本身即反馈。（编号保留，避免打乱 implement.md 里对 R5.5 的引用。）
- R5.5 跳转必须摘掉跟随 pin（见 Background 的派生风险），否则异步内容长高会把视图拽回底部；落到最后一条时按既有 `handleScroll` 规则自然重挂（`:261-266`）。
- R5.6 `prefers-reduced-motion` 下不做平滑滚动与过渡动画。

## Acceptance Criteria

- [ ] 视图滚离底部后，消息区底部出现滚动到底部按钮（横向贴消息内容列右边缘，不贴视口边缘）；回到底部后按钮消失。
- [ ] 点击该按钮：消息区平滑滚到底部，且后续流式输出继续跟随（pin 已重挂）。
- [ ] Composer 右组顺序为"聊天地图 → 展开/收起 → 发送/停止"，空会话时地图按钮禁用。
- [ ] 点击聊天地图按钮弹出居中浮层，列表按对话顺序列出全部当前渲染的消息，每条一行气泡、超长截断、用户/助手可区分。
- [ ] 点击浮层中任意一条：浮层关闭，消息区平滑滚到该条并置于视口顶部（落地不做高亮）。
- [ ] 跳转到**中间**的消息后停留 5s（期间若有异步渲染长高），视图不会被拽回底部 —— R5.5 的回归验证。
- [ ] 每条渲染出来的消息 `<article>` 都带锚点属性；切换版本后该组锚点不变。
- [ ] 键盘可达：浮层内条目可 Tab 聚焦并 Enter 触发跳转；两个新按钮都有 `aria-label`。
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿。`pnpm test` 里的 integration 项目需要本地 Postgres，无库环境会失败（与本次改动无关），组件层以 unit-dom / unit-node 为准。
- [ ] 桌面与移动两个断点都验过（`.trellis/spec/frontend/component-guidelines.md:85-105` 要求两个断点都是一等公民）。

## Out of Scope

- **滚动条缩略图 / minimap**：不做等比缩略条，聊天地图就是列表浮层。
- **浮层内搜索 / 过滤**：列表不做搜索框，靠滚动找。
- **浮层里的当前位置指示与自动滚动定位**：明确不做（用户裁定）。
- **消息虚拟化**：不引入 react-virtuoso 等，仍全量渲染，长对话性能不在本次范围。
- **版本组展开**（在浮层里列出同组的其他版本）：只列当前显示版本。

## Technical Notes

- 锚点与 React key 同粒度（`groupId ?? id`），是实现时最容易搞错、且错了不会报错只会错位的点。
- 跳转必须摘 pin（R5.5），这是与既有滚动规约的耦合点。
- 关闭浮层与滚动的时序：Base UI Dialog 关闭有动画，滚动在关闭后的下一帧执行。
- 跳后高亮（ring）已按用户反馈移除：全宽 `<article>` 上的 ring 视觉上像一条色带，实测不好看；滚动位置本身足以指示落点。

## Notes

- 本文件只描述需求、约束与验收；技术设计放 `design.md`，执行计划放 `implement.md`。
