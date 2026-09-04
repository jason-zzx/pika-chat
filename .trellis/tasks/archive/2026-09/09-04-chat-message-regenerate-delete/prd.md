# chat message regenerate and delete

## Goal

聊天消息支持重新生成（多版本可切换）与删除；消息操作容器增加重新生成入口与展开菜单。提升用户对单条回答的迭代能力：不满意的回答可以重试并保留历史版本，对话内容可以逐条清理。

## Background / Confirmed Facts

- 消息存于 `chat_messages` 表（`src/server/db/schema/chat.ts`）：扁平结构，按 `topicId + createdAt + id` 排序，无版本/分组概念。
- 后端服务：`src/server/services/message.service.ts`（`listTopicMessages` / `appendUserMessage` / `appendAssistantMessage`）；写路径在 `src/app/api/chat/route.ts`（流式，`onEnd` 持久化 assistant 消息）。
- 历史加载：`GET /api/topics/[id]/messages` → `useChatHistory`（React Query）→ `ChatView` 用 `setMessages` 注入 `useChat`；`seededHistoryFor` ref 控制每个 topic 只 seed 一次。
- 发送请求只带最后一条用户消息，服务端从 DB 重建全部历史（`listTopicMessages` + `convertToModelMessages`）——因此 `listTopicMessages` 返回"每组的当前选中版本"即可自动满足"上下文只带选中版本"。
- 操作容器：`src/components/chat/MessageActions.tsx`，目前只有复制按钮，hover 显示；`MessageItem.tsx` 渲染用户/AI 消息。
- `src/components/ui/dropdown-menu.tsx` 已存在，可用于展开菜单。
- 消息元数据契约见 `.trellis/spec/backend/chat-message-metadata.md`：新增 per-message 信息走 `chatMetadataSchema` 可选字段 + DB 列 + `metadataFromRow` + 组件消费的完整链路。
- Topic 与消息是 cascade 删除；删除全部消息不影响 topic 本身。

## Requirements

- R1 **重新生成（AI 回复）**：对一条 assistant 消息重新生成时，不覆盖原回答，而是为该回答新增一个版本；同一回答位置可同时存在多个版本。
  - 对非末尾消息重新生成时，不截断、不改动任何后续消息。（D1）
  - 用户消息上的"重新生成"= 对其后紧邻的 AI 回答新增一个版本；若紧随其后没有 AI 回答，则在该位置生成第一条回答。（D1）
  - 重新生成使用 composer 当前选择的模型与 reasoning effort。（D3）
  - 重新生成的流式过程与正常发送一致：实时渲染、可停止；停止/失败的版本也作为版本持久化（沿用现有 outcome 语义）。
- R2 **版本切换 UI**：多版本消息下方显示切换工具，样式为 `← 当前序号/总版本数 →`，位于操作工具容器（复制图标所在容器）的左侧；仅版本数 > 1 时显示。
- R3 **版本选择持久化**：当前选中版本持久化到服务端，刷新/重新打开 topic 后保持；服务端构造模型上下文时只带每组的当前选中版本。（D2）
- R4 **重新生成入口**：用户消息和 AI 回复消息的操作工具容器中，复制图标左侧增加"重新生成"图标。
- R5 **删除**：删除该条对话；多版本时只删除当前选中版本；删除选中版本后回落到其余版本中的最新一版；允许一直删除直到对话清空；对话清空后 topic 保留且可继续发送新消息。
- R6 **展开菜单**：操作容器最右侧增加展开图标（横向三点），点击展开菜单。
  - AI 回复：复制、重新生成、删除并重新生成、删除。
  - 用户消息：复制、重新生成、删除（无"删除并重新生成"）。（D4）
  - "删除并重新生成"= 先删除当前版本，再按 R1 规则生成新版本；若删除的是该位置唯一版本，则基于前面的用户消息生成全新回答。

## Resolved Decisions

- D1: 非末尾消息重新生成/删除不截断后续消息；用户消息的重新生成 = 为下一条 AI 回答加版本。
- D2: 版本选择持久化到服务端，服务端按选中版本构造上下文。
- D3: 重新生成使用 composer 当前选择的模型与 reasoning effort。
- D4: 用户消息的展开菜单不含"删除并重新生成"。

- R7 **思考闪动占位**（Phase 2 迭代新增）：流式助手消息还没有任何内容（无 text/reasoning part）时，在助手名下方内容区显示 ChatGPT 风格的 "Thinking…" 渐变闪动文字；首个 part 到达即替换。首次回复与重新生成都适用。重新生成点击后**立即**显示闪动（不等首个 chunk 到达）；动画效果需明显可见。
- R8 **触屏点按显示操作区**（Phase 2 迭代新增）：移动端无 hover，点击消息区域任意位置切换该行 meta/操作区的显示；与桌面 hover/focus-within 共存且不回归；点击操作区内按钮/链接不触发切换；鼠标划选文本不触发。

- R9 **点按显示的“单条激活”语义**（Phase 2 迭代 3 新增，修订 R8）：点击消息点出该行的 meta/操作区后，**不再**通过再次点击同一条消息来收起；只有点击**其他**消息时才消失（同时显示被点击那条）。列表中至多一条消息处于点出状态。适用范围包括操作区、时间戳、版本切换器（切换器不再多版本常显，同样受点出规则控制）。桌面 hover/focus-within 的瞬时显示不受此规则影响，保持不变。
- R10 **新话题 reseed 修复**：新话题首条回复重新生成成功后，版本切换器无需刷新即应出现（见 B8）。
- R11 **复制降级**：非安全上下文（如 http 局域网访问）下 `navigator.clipboard` 不可用，复制需有降级方案（execCommand），且失败状态对用户可见。

## Bug List (Phase 2 review round)

- B1：版本切换后操作区显示状态丢失——未点出操作区时切换会先闪现再消失；已点出时切换后直接消失。根因方向：切换后服务端 reseed 换了 message id 导致组件 remount，`revealed` 状态被重置。期望：操作区显示状态按消息槽位/组记忆，切换/删除/重新生成后保持。
- B2：点出操作区后打开三点菜单，操作区消失只剩菜单；点击别处收起菜单后操作区又出现。期望：菜单打开期间操作区保持可见（菜单 open 状态计入 reveal 条件）。
- B3：菜单项 "Delete and regenerate" 换行；菜单项文本不得换行（whitespace-nowrap）。
- B4：复制按钮点击后 2 秒对勾图标的反馈丢失，需恢复（MessageActions 重构时回归）。
- B5：见 R7——闪动不明显，且重新生成时完全没出现（regenerate 的流式占位逻辑有问题）。
- B6：新建话题发送首条消息后，立即对回复重新生成报 "message not found"；刷新后正常。根因方向：本地消息 id 与服务端持久化不一致或 onEnd 持久化竞态（客户端在服务端持久化完成前就发起 regenerate）。

- B7（迭代 3）：点按显示语义不符合预期——见 R9。
- B8（迭代 3）：新话题首条回复重新生成后版本切换器不显示，刷新后才出现。根因已定位：`ChatView` 中 `useChatHistory(topicId)` 用的是路由 prop `topicId`；新话题经 `history.replaceState` 写入 URL 但不触发路由重渲染，`topicId` 恒为 `undefined`，history 查询一直 disabled，重新生成后的 reseed 拿不到服务端的版本元数据。修复方向：history 查询改用 `activeTopicId`（`topicId ?? createdTopicId`）。
- B9（迭代 3）：Android Chrome 复制失败、无对勾反馈。根因已定位：复制仅用 `navigator.clipboard.writeText`；http 局域网（非安全上下文）下 `navigator.clipboard` 为 undefined，直接抛错且无任何降级。修复：clipboard API 不可用或拒绝时降级隐藏 textarea + `document.execCommand("copy")`；两者都失败才置 failed 状态。

## Acceptance Criteria

- [ ] AC1（R1）：对一条 AI 回答点重新生成，流式产生新回答；完成后切换工具显示 `2/2`，原版本保留且可切回。
- [ ] AC2（R1/D1）：对中间位置的回答重新生成后，其后的消息内容、顺序不变。
- [ ] AC3（R1/D1）：对用户消息点重新生成，其后的 AI 回答新增一个版本；该用户消息后没有回答时，在原位置生成新回答。
- [ ] AC4（R3）：切换到旧版本后刷新页面，仍显示旧版本；此时发送新消息，服务端收到的上下文中该位置是旧版本内容（可用服务层测试验证）。
- [ ] AC5（R3/D3）：重新生成使用 composer 当前选择的模型；新生成版本的 metadata 记录该模型。
- [ ] AC6（R5）：删除多版本回答的当前版本后，显示其余版本中最新一版，版本数减一；删除唯一版本后该消息消失；逐条删除至对话清空后，topic 仍在侧边栏且可继续发送。
- [ ] AC7（R5/D1）：删除中间一条消息，其前后消息不受影响。
- [ ] AC8（R4/R6）：用户/AI 消息的操作容器包含：版本切换器（多版本时）、重新生成图标、复制图标、三点菜单；菜单项按 R6 区分角色。
- [ ] AC9（R1）：重新生成过程中可点停止，该版本以 stopped 状态保留为一个版本。
- [ ] AC10：现有发送/停止/标题生成/历史加载行为不回归（现有测试全绿）。
- [ ] AC11（R7）：首次回复与重新生成，在首个内容到达前内容区显示明显的 "Thinking…" 闪动；内容到达即被替换；重新生成点击后立即出现。
- [ ] AC12（R8）：移动端（无 hover）点击消息区域可点出/收起操作区；桌面 hover 行为不变。
- [ ] AC13（B1/B2）：切换版本、删除、重新生成后操作区显示状态保持；三点菜单打开期间操作区不消失。
- [ ] AC14（B3/B4）：菜单项不换行；复制按钮 2 秒对勾反馈恢复。
- [ ] AC15（B6）：新建话题首条回复后**不刷新页面**直接重新生成成功，无 message not found。
- [ ] AC16（R9/B7）：点击消息 A 点出其 meta/操作区/版本切换器；点击消息 B 后 A 的收起、B 的显示；再次点击 A 不收起；任意时刻至多一条处于点出状态；桌面 hover 瞬时行为不变。
- [ ] AC17（B8）：新建话题首条回复重新生成后，不刷新页面即可见版本切换器 `2/2`。
- [ ] AC18（B9）：非安全上下文（http 局域网）Android Chrome 下复制成功且显示对勾反馈；复制真正失败时显示失败状态。

## Out of Scope

- 编辑用户消息文本。
- 用户消息自身的多版本（版本只针对 AI 回答）。
- 重新生成时切换 assistant 或 system prompt。
- 多端实时同步（刷新后一致即可）。
- 删除时的二次确认对话框（单条删除直接生效）。
