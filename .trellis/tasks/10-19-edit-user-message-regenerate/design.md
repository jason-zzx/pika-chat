# 技术设计：用户消息编辑后重新生成

## 1. 总体思路

编辑 = 「用户消息版本组新增一个选中版本」+「对紧随其后 assistant 组的一次重新生成」。服务端不新增端点，在现有 `POST /api/topics/[id]/messages/[messageId]/regenerate` 上扩展可选 `edit` 负载；客户端复用 `regenerate-stream.ts` 的占位/折叠/重播种机制，新增就地编辑器 UI。

```
点击发送
  ├─ 客户端：mint 新用户消息 id → 乐观替换列表中的用户消息 → 插入 regen 占位
  └─ POST regenerate { ..., edit: { id, parts } }
       ├─ requireModelForActor（模型不可用 → 任何写入前 4xx，既有行为）
       ├─ resolveRegenerateTarget（含压缩区断言，既有）
       ├─ edit 校验：目标必须是 user 角色；parts 经 chatRequestMessageSchema；
       │   file parts 经 resolveOwnedFileParts（归属+规范化，先于任何写入）
       ├─ appendUserMessageVersion：事务内 deselect siblings + insert 新选中版本
       ├─ resolveRegenerateTarget({ messageId: edit.id }) 重新取 history
       │   （新版本已选中，selectedView 自然包含编辑后内容）
       └─ 以下完全走现有 regenerate 流程（附件重路由、图片旁路、压缩边界、
          streamText、onEnd 以 targetGroupId 持久化 assistant 新版本）
```

## 2. 服务端变更

### 2.1 Schema（`src/lib/schemas/chat.ts`）

`regenerateMessageRequestSchema` 增加：

```ts
edit: chatRequestMessageSchema.optional()
```

直接复用发送消息的 schema（`id` + `parts.min(1)`；仅附件无文本合法）。

### 2.2 `message.service.ts` 新增 `appendUserMessageVersion`

```ts
appendUserMessageVersion(
  input: { topicId: string; groupId: string; message: ChatUIMessage; createdAt?: Date },
  actor: Actor,
): Promise<ChatUIMessage>
```

- `requireOwnedTopic` + 校验 `groupId` 对应组存在且角色为 user（否则 `NOT_FOUND`）。
- 事务：`update chat_messages set is_selected=false where topic_id and group_id` → `insert` 新行（id 取客户端传入；role=user；parts 过滤 text/file；groupId=input.groupId）。与 `appendAssistantMessage` 的版本分支同构，满足部分唯一索引（C1）。
- `createdAt`：传 app 侧 turn-start 时间（与 `appendUserMessage` 注释相同的时钟对齐理由）。

### 2.3 regenerate 路由（`src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts`）

在 `resolveRegenerateTarget` 之后、流式之前插入 edit 分支：

1. `edit` 存在时：
   - 目标行角色必须是 user，否则 `AppError("VALIDATION_FAILED", 400, ...)`。
   - `resolveOwnedFileParts(edit.parts.filter(file))` + text parts 过滤，组装规范化 parts（files first then text，同 /api/chat 顺序理由）。伪造/他人 file id 在此 4xx，无任何写入（C2）。
   - `appendUserMessageVersion({ topicId, groupId: target.groupId, message: { id: edit.id, role: "user", parts }, createdAt: new Date() })`。
   - 重新 `resolveRegenerateTarget({ topicId, messageId: edit.id })` 得到 `{ targetGroupId, history }`（history 含编辑后新版本；targetGroupId 为紧随其后 assistant 组或 null）。
2. 之后流程一字不改。`resolveAttachmentsForModel` 对整个 history 重路由，编辑后新附件自然走既有路由/降级规则；路由失败发生在用户版本持久化之后——此时编辑已生效、assistant 侧无新版本，属 C3 接受的语义（与"附件路由失败但消息已存"的普通发送不同，这里用户编辑本身不丢）。

### 2.4 版本元数据放开（C4）

`rowToChatUIMessage` 移除 `row.role === "assistant"` 门限：所有角色都携带 version metadata。影响面核查：`select` 端点、`deleteMessage`、`resolveRegenerateTarget` 均角色无关；前端 switcher 角色无关。spec `chat-message-versions.md` 在 Phase 3.3 同步（"assistant rows only" 表述及 user single-version 假设）。

## 3. 前端变更

### 3.1 `MessageActions.tsx`

- 新增可选 `onEdit?: () => void`。
- `messageRole === "user" && onEdit` 时：操作区**最左**渲染铅笔图标按钮（`PencilIcon`，aria-label/title 取 i18n `editMessage`）；下拉菜单在最上方加「编辑」项。
- 现有 reveal/tap、menu keep-alive 机制不变。

### 3.2 就地编辑器（`MessageItem.tsx` 内嵌，或拆 `UserMessageEditor.tsx`）

- `MessageItem` 增加 `editing` 本地状态与 `onEditSubmit(message, draft)` prop（由 ChatView 经 MessageList 透传）。
- 编辑态替换气泡内容：自动增高 textarea 预填当前文本；附件区复用 `useComposerAttachments`（初值为当前版本的 file parts 映射成的已上传附件）+ `AttachmentChip`；底部右对齐「取消」「发送」按钮（`Button` 组件，i18n 复用 `Common.cancel` / 发送文案）。
- 发送禁用条件：上传进行中、或（文本 trim 后为空且无附件）。
- 提交时组装 parts：`[...fileParts, ...textParts]`（files first，与服务端一致）。
- 若 `useComposerAttachments` 与 composer 耦合过深（依赖 composer 专用上下文），允许抽一个最小适配层，但**不得**复制上传/校验逻辑；跨域复用遵守 memory #100（共享 hook 放中性目录）。

### 3.3 `ChatView.tsx` 新增 `handleEditSubmit`

```
handleEditSubmit(message, draft):
  guard: inFlight（chat 或 regen）/ !pickedModel / compressedLocked → 忽略或禁用入口
  newId = crypto.randomUUID()（与客户端既有消息 id 生成方式一致）
  edited = { id: newId, role: "user", parts: draft.parts,
             metadata: { ...message.metadata, groupId,
                         versionIndex: count+1, versionCount: count+1,
                         versionIds: [...ids, newId] } }
  setMessages: 用 edited 替换 message（同位置）
  plan = buildRegenPlaceholder(messages, { id: newId, role: "user" }, index)
  insertRegenPlaceholder → 立即 shimmer（R6）
  走与 handleRegenerate 完全相同的流式消费路径：
    regenerateTopicMessage(topic, message.id /* 原消息 id 作路径参数 */, {
      providerConfigId, modelId, reasoningEffort, searchMode, image, timeZone,
      edit: { id: newId, parts: draft.parts },
    })
    upsertRegeneratedMessage 折叠帧（target = { id: newId, role: "user" }）
  失败（流开始前）：removeRegenPlaceholder + 恢复原用户消息 + apiErrorMessage toast（AC8）
  finally：teardown 清 seededHistoryFor + invalidate history（既有 reseed，收敛版本元数据）
```

- 路径参数用**原消息 id**（用户点击的那条）：`resolveRegenerateTarget` 按 id 找组，新旧 id 同组等价；用原 id 避免与服务端持久化时序耦合。
- stop 行为复用：`regenStopRequestedRef` 与 stream-id header 机制不变。

### 3.4 滚动行为

走 regenerate 路径（非 composer 发送），不触发 send-reserve；流式增长由既有 ResizeObserver 规则处理（非 tail 流式不拽动视图，memory #21 第 3 条天然兼容中段编辑）。实现时验证：编辑尾部消息 vs 中段消息的滚动表现与现有 regenerate 一致，不新增滚动逻辑。

### 3.5 i18n

`Chat.Actions` 新增 `editMessage`（图标 aria/title）与 `edit`（菜单项）；编辑器按钮复用现有 common 文案。中英两份 locale 文件同步。

## 4. 兼容性与边界

- 旧的单版本用户消息不受影响（groupId=id 单版本组；编辑后变多版本组）。
- `deleteMessage` 删除用户消息选中版本时已会重选同组最新版本——对用户版本组天然正确，无需改动；补充测试覆盖。
- 两个连续用户消息（回答被删）时编辑前一条：history 含编辑版本，targetGroupId=null 开新槽位——与 regenerate 的"紧随其后"规则一致。
- 压缩区目标由 `assertTargetNotCompressed` 拒绝（edit 分支在其之后执行，写入不会发生）。
- 图片生成模型：edit 分支持久化用户新版本后进入既有 image bypass，参考图从新版本的 file parts 重新解析（`resolveImageReferences` 读 history 最后一条 user 消息，已是编辑后版本）。

## 5. 测试设计

- 服务端集成（`message.service.integration.test.ts` / 路由层）：
  - edit 持久化：新版本选中、旧版本保留且 deselect、组位置不变、history 含新内容。
  - 非 user 目标带 edit → 400；压缩区目标带 edit → 拒绝且无写入；伪造 file id → 4xx 且无写入。
  - 多版本用户组的 `listTopicMessages` 元数据（versionIndex/Count/Ids）。
- 服务端单元：`rowToChatUIMessage` 用户行携带版本元数据；`appendUserMessageVersion` 事务/角色校验。
- 组件：`MessageActions` 用户消息出现编辑图标与菜单项、assistant 不出现；`MessageItem` 编辑态进出、取消无写入、空内容禁用发送；附件 chip 增删。
- ChatView：edit 提交 → 乐观替换 + 占位 + 流折叠 + reseed；失败回滚本地状态。

## 6. 风险与回滚

- 风险点主要在客户端状态折叠（占位/乐观替换/reseed 时序），已有 `regenerate-stream.ts` 测试基建可复用。
- 回滚：revert 单次 commit 即可；已落库的多版本用户消息组在旧代码下表现为何？`rowToChatUIMessage` 旧门限只是不带元数据，选中版本仍正确返回——**向后兼容，无数据迁移**。
