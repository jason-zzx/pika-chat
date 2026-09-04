# Design: chat message regenerate and delete

## Architecture Overview

版本模型落在现有 `chat_messages` 表上：新增"版本组"概念（`groupId`），一组内的多行是同一回答位置的多个版本，每组有一个持久化的选中版本（`isSelected`）。`listTopicMessages` 改为返回"每组选中版本"的视图并附带版本元数据——这样 `/api/chat` 的上下文构造、历史加载 API、前端 seed 三处自动一致，无需各自实现过滤。

新增三个 API：regenerate（流式）、delete、select。前端在 `ChatView` 内手动消费 regenerate 的 UI message stream（不经过 `useChat.sendMessage`，因为它会追加用户消息），完成后通过重置 `seededHistoryFor` + invalidate 让 server 状态重新 seed。

## Data Model (`src/server/db/schema/chat.ts`)

`chatMessages` 新增两列：

- `groupId: text not null` — 版本组标识。新消息默认等于自身 `id`（单版本组）；重新生成的版本继承目标组的 `groupId`。迁移时 backfill：`group_id = id`。
- `isSelected: boolean not null default true` — 组内当前选中版本。

约束与索引：

- 部分唯一索引：`uniqueIndex on (groupId) where is_selected`（groupId 本身是首版消息 id，全局唯一），保证每组至多一个选中版本。
- 复合索引 `(topicId, groupId)` 支持组内查询。
- 迁移为 additive + backfill，一条 migration 完成（列 → backfill → not null → 索引）。不改动既有列，无 destructive 操作。

组内版本序号不建列：`versionIndex` 由组内 `createdAt, id` 排序的位次派生（版本只增不改，位次稳定）。

## Service Layer (`src/server/services/message.service.ts`)

- `listTopicMessages({ topicId }, actor)`：取出 topic 全部行 → 按 `groupId` 分组（组位置 = 组内最早版本的 `createdAt`）→ 每组取 `isSelected` 行（缺失时兜底最新版本）→ 每个返回消息附带版本元数据（见下）。返回顺序 = 组位置升序。
- `appendAssistantMessage` 增加可选 `groupId`：给了就在**一个事务**里插入新行（`isSelected=true`）并把组内其他行置 `false`；没给则 `groupId = 自身 id`。
- `appendUserMessage`：`groupId = 自身 id`。
- `deleteMessage({ topicId, messageId }, actor)`：校验归属后删除该行；若删的是选中版本且组内还有剩余版本，同事务把最新剩余版本置为选中。返回 `{ deleted: true, groupEmpty: boolean }`。
- `selectMessageVersion({ topicId, messageId }, actor)`：同事务把目标行置选中、组内其他行置未选中。
- `resolveRegenerateTarget({ topicId, messageId }, actor)`：
  - 目标是 assistant 消息 → `targetGroupId = 其 groupId`；`history` = 组位置在该组之前的所有选中消息。
  - 目标是 user 消息 → 找紧随其后的组：若是 assistant 组，`targetGroupId = 该组 groupId`，`history` = 该组之前的选中消息；否则 `targetGroupId = null`（新回答槽位），`history` = 截至该 user 消息（含）的选中消息。
  - 返回 `{ targetGroupId, history }`（`history` 为 `ChatUIMessage[]`）。

归属校验统一走现有 `requireOwnedTopic` 模式；对 messageId 校验其 `topicId` 匹配，不匹配按 404 处理（missing 与 forbidden 不可区分，见 error-handling spec）。

## API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/topics/[id]/messages/[messageId]` | DELETE | 删除单条（当前版本）。204。 |
| `/api/topics/[id]/messages/[messageId]/select` | POST | 把该消息置为其组选中版本。204。 |
| `/api/topics/[id]/messages/[messageId]/regenerate` | POST | 流式生成新版本。body: `{ providerConfigId, modelId, reasoningEffort? }`（zod schema 放 `src/lib/schemas/chat.ts`）。 |

regenerate 路由复用 `/api/chat` 的骨架（模型可用性校验 → `createChatModelHandle` → `registerStream` → `streamText` → `createUIMessageStream` → `onEnd` 持久化），差异：

- 不创建 topic、不追加用户消息、不触发标题生成；`history` 来自 `resolveRegenerateTarget`。
- `streamId` 通过响应头 `x-pika-stream-id` 返回（不用 `data-topic` chunk——客户端不走 `useChat`，用 `readUIMessageStream` 消费，data part 无法方便地取出）。
- 不复用 `originalMessages`：流里只有新 assistant 消息一条，客户端自行决定插入位置。
- `onEnd` 调 `appendAssistantMessage({ ..., groupId: targetGroupId ?? undefined })`；停止/失败同样持久化为一个版本（`outcome` 语义不变），然后 `releaseStream`。
- finish 的 `messageMetadata` 沿用现有字段（providerConfigId/modelId/createdAt/reasoningMs/totalTokens/finishReason）；版本元数据流式期间不下发，等 reseed 收敛。

Stop 复用现有 `POST /api/chat/stop`（stream-registry 不区分来源）。

## Metadata Contract (`src/lib/schemas/chat.ts`)

按 chat-message-metadata spec 扩展 `chatMetadataSchema`（全部 optional，只增不改）：

- `groupId?: string`
- `versionIndex?: number`（1-based，选中版本在组内按 createdAt 的位次）
- `versionCount?: number`
- `versionIds?: string[]`（组内全部版本 id，按 createdAt 升序，供切换器直接取目标 id）

仅 assistant 行下发版本元数据（用户消息恒为单版本组）。流式中的新消息没有这些字段，reseed 后收敛——与 spec 的"live 与 reloaded 最终一致"契约兼容。

## Frontend

### `lib/api/chat.ts`

新增 `deleteTopicMessage` / `selectMessageVersion`（`parseEmpty`），`regenerateTopicMessage` 返回裸 `Response` 供流式消费（失败时走 `apiErrorMessage` 提取）。

### ChatView

- 新状态 `regen: { streamId: string | null; streamingId: string } | null`；`inFlight` 扩展为 `chatInFlight || regen !== null`，复用现有 canSend/停止按钮的互斥。
- `handleRegenerate(message, index)`：守卫（`!inFlight && pickedModel && activeTopicId && history.isSuccess`）→ POST → 读 `x-pika-stream-id` → `readUIMessageStream({ stream: response.body })` 逐帧 `setMessages`：若被点的是 assistant，原位替换该 index；若是 user，在其后插入流式消息。正常结束/出错/停止后统一收尾：`seededHistoryFor.current = null` + invalidate `chatKeys.history(topicId)`，由既有 seed effect 从服务端重新同步（这保证版本元数据、选中态与服务端一致）。
- `handleDelete(message)`：DELETE → 本地 `setMessages` 移除该 id → `seededHistoryFor.current = null` + invalidate。
- `handleSelectVersion(versionId)`：POST select → `seededHistoryFor.current = null` + invalidate。
- `handleDeleteRegenerate(message)`：先 DELETE；若 `versionIds` 中还有剩余版本则对最新剩余版本 id 调 regenerate，否则对该组之前的最近一条 user 消息调 regenerate（其"无后续回答"分支会新建回答）。删除已生效后再失败，仅提示错误，不回滚删除（语义即"先删再生成"）。
- `handleStop` 扩展：若 `regen` 进行中，先 `stopChatStream(regen.streamId)` 再走收尾。
- 版本切换、删除、重新生成全部要求服务端往返确认后再改界面（不做过度的乐观更新），保证单一事实源。

### MessageList / MessageItem / MessageActions

- `MessageList` 增加 `streamingMessageId?: string` prop：`streaming` 判定从"最后一条 assistant"扩展为"`message.id === streamingMessageId` 或原有的末尾逻辑"。
- `MessageItem` 从 `message.metadata` 取版本信息传给 `MessageActions`。
- `MessageActions` 重排布局：`[← n/N → 切换器（versionCount>1 时）] [重新生成] [复制] [三点菜单]`。
  - 切换器：`ChevronLeft/ChevronRight` + `n/N` 文本，到达边界禁用。
  - 菜单用 `src/components/ui/dropdown-menu.tsx`；assistant：复制/重新生成/删除并重新生成/删除；user：复制/重新生成/删除。
  - 保持现有 hover 显示、focus-visible、`aria-label` 风格；切换器在多版本时常显（不依赖 hover），避免闪烁。

## Compatibility & Migration

- 迁移对存量数据纯 additive：每行自成一组且选中，历史接口输出与现状逐条等价（只是多了版本元数据字段）。
- 旧客户端忽略新 metadata 字段（zod optional）；新前端对缺版本元数据的消息按单版本处理（不显示切换器）。
- `GET messages` 响应结构不变（`{ messages }`），仅元素 metadata 扩展。

## Trade-offs

- **`isSelected` 布尔列 + 部分唯一索引** vs 独立 selection 表：选前者——消息本来一次性全取，组内翻牌在 service 层事务内完成，省去 join；代价是两步写必须包事务（已在 service 约束）。
- **regenerate 独立路由 + 手动消费流** vs 扩展 `/api/chat` 复用 `useChat`：选前者——`useChat.sendMessage` 语义上绑定"追加用户消息"，硬塞进 regenerate 会污染消息数组与 transport 假设；代价是 ChatView 多一段流消费代码和 `streamingMessageId` 传递。
- **版本元数据放 metadata 而非顶层字段**：遵循 chat-message-metadata spec 的既定契约，live/reload 收敛机制现成。

## Rollback

- 代码回滚 + 数据库保留新列（additive 列不影响旧代码运行）。若需彻底回滚：另写 destructive migration 删列删索引（单独 migration，符合 database-guidelines）。
