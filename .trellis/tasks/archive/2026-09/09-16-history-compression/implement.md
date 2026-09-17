# 会话历史压缩 — 执行计划

> 验证命令：`pnpm lint` · `pnpm typecheck` · `pnpm test`（必要时 `pnpm vitest run <file>` 单测）
> 迁移：`pnpm db:generate` 生成迁移文件（由用户执行 `pnpm db:migrate` 应用）

## Checklist

1. [x] **DB schema**：`topics` 增加 `summary_text` / `summary_up_to_message_id` / `summary_updated_at`（均 nullable）；`pnpm db:generate` 生成迁移。
2. [x] **compression.service.ts**：token 估算启发式、有效上下文计算、`compressTopicHistory`（旧摘要 + 已选版本消息 → generateText → 持久化滚动更新）。
3. [x] **buildChatInstructions 扩展**：增加可选 `historySummary` 参数（规则 #109 的唯一入口），补单元测试。
4. [x] **chat 路由自动触发**：`src/app/api/chat/route.ts` 在 `listTopicMessages` 之后、`resolveAttachmentsForModel` 之前调用 maybe-compress；摘要生成失败时降级为未压缩继续。
5. [x] **手动端点**：`POST /api/topics/[id]/compress/route.ts`（归属校验、强制压缩、返回边界与压缩条数）。
6. [x] **topic 查询透出**：`GET /api/topics/[id]` 返回 `summaryUpToMessageId`。
7. [x] **Composer 图标**："压缩上下文"按钮（draft/流式禁用）+ 调用手动端点 + 失效化 topic 缓存。
8. [x] **MessageList 标记**：边界消息后渲染"早期对话已压缩"分隔条。
9. [x] **i18n**：`Chat.Compression.*` 中英文案。
10. [x] **测试**：估算/边界/有效上下文单测；压缩端点与自动触发集成测试。
11. [x] **regenerate 路由对齐**（检查后追加）：`src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts` 在 `resolveRegenerateTarget` 之后应用与 chat 路由相同的摘要裁剪——history 裁到边界之后（边界消息本身被重新生成时允许为空）、`buildChatInstructions` 传入 `historySummary`；不在 regenerate 中触发新压缩，只复用已持久化的摘要状态。
12. [x] **压缩进行中提示**（用户反馈，PRD R7/AC8）：`MessageList` 新增 `compressingHistory?: boolean` 属性——为 true 时在列表末尾渲染分隔条样式的闪动提示（复用现有 `animate-thinking-shimmer` + `role="status"`），文案 `Chat.Compression.compressing`；`ChatView` 把手动压缩的 `compressing` 状态透传下去（自动触发路径无客户端状态，不涉及）。
13. [x] **测试补充**：`MessageList.test.tsx` 覆盖 compressingHistory 提示的显示与移除。
14. [x] **服务端：摘要正文透出**（PRD R9/AC10）：`GET /api/topics/[id]` 在 `summaryUpToMessageId` 之外增加 `summaryText`（nullable）；`topicDetailSchema` 同步；`useTopicDetail` 直接可用。只读，不改写入路径。
15. [x] **服务端：压缩区锁定**（PRD R10/AC11）：`message.service.ts` 新增局部守卫（不引入 compression.service 依赖以免循环）——按话题读取 `topics.summary_up_to_message_id`，用与边界相同的 group 语义判定目标是否落在压缩区内；`deleteMessage` 与 `resolveRegenerateTarget` 命中时抛 `AppError("CONFLICT", 409, "message.compressedLocked")`；`Errors.message.compressedLocked` 中英同改。
16. [x] **客户端：可折叠总结**（PRD R9/AC10）：`MessageList` 的边界分隔条改为可展开的总结面板（默认收起；真实 button + `aria-expanded`/`aria-controls={useId()}` + chevron + `grid-rows-[1fr]/[0fr]` 动画，与译文块折叠约定一致）；面板内容为 `summaryText`；`ChatView` 从 `useTopicDetail` 取 `summaryText` 透传。
17. [x] **客户端：压缩区锁定入口**（PRD R10/AC11）：`MessageList`/`MessageItem` 接收压缩区边界信息，落在边界（含）之前的消息不渲染删除与重新生成菜单项（其余操作不受影响）；触摸可达性不受影响。
18. [x] **客户端：图标与 title 统一**（PRD R8/AC9）：压缩按钮改用 `ListCollapseIcon`；逐个排查 Composer 内图标按钮，补齐缺失的 `title`（已有 `aria-label` 保留），确保两属性一致。
19. [x] **测试补充**：服务端（delete/regenerate 锁定 409、边界之后不受影响、`GET /api/topics/[id]` 返回 `summaryText`）；组件（总结面板展开/收起与默认收起、压缩区内消息无删除/重新生成入口、Composer 所有图标按钮均有 `title`）。

## 检查后修正（第二轮 check 发现，F1/F2/F4/F5）

- **F1（Medium）压缩边界跨层语义不一致**：边界持久化的是当时的已选版本行 id；客户端按 id 在已选视图里匹配、服务端锁定按 raw rows 版本组匹配、服务端裁剪又按 id 匹配——三者分叉。用户切换边界消息组的版本后：客户端锁定与分隔条消失、服务端仍 409、且摘要与全文重复（`messagesAfterBoundary` 回退为全文）。
  - 修正（方案 A，统一到 group 语义）：`getTopicSummaryState` 额外返回 `summaryUpToGroupId`（边界行的 `group_id`）；`findTopicDetailForActor` / `topicDetailSchema` / `GET /api/topics/[id]` 透出；`messagesAfterBoundary` 按 `metadata.groupId ?? id` 匹配（旧数据无 group 时回退原 id 匹配）；`MessageList` 的锁定与分隔条同样按 group 匹配；`message.service` 的锁定守卫保持 group 语义不变。
  - 测试：集成（切换边界组选中版本后，裁剪仍只含边界之后、delete/regenerate 仍 409）；组件（边界信息为同组另一版本 id 时分隔条与锁定仍生效）。
- **F2（Low）降级丢摘要**：`/api/chat` 的 catch 把 `topic.nothingToCompress`（历史已被摘要全覆盖）也当成摘要失败，降级为“全量历史 + 无摘要”。修正：先判断是否确实有新的可压缩消息（`messagesAfterBoundary(...).length > 0`）再调压缩；`catch` 中重新按已持久化 `summaryState` 计算 `historySummary`/`modelHistory`，保留旧摘要，不因一次失败丢掉已有压缩成果。
- **F4（Low）AC9 字面缺口**：`AttachmentChip` 的重试/移除图标按钮只有 `aria-label`，补 `title`（同值），并补一条带 `attachments` 的 Composer 测试。
- **F5（Low）测试缺口**：补 `GET /api/topics/[id]` 的归属隔离断言（用户 A 读不到用户 B 的 topic detail）。

## 第三轮：ponytail 简化（用户要求“验证并执行优化”）

代码审查（过度设计视角）提出 10 项，采纳 9 项、拒绝 1 项。均为等价重构，不得改变可观测行为。

20. [x] **删除死列 `topics.summary_updated_at`**：schema:44 的列每次压缩都写入、`TopicSummaryState` 也 select，但全仓库无任何读取方。删除列 + `summaryUpdatedAt` 字段 + select + `.set`；迁移 0022 未提交未上线，直接删掉 0022 的 sql/snapshot/journal 条目后 `pnpm db:generate` 重新生成（只含 2 列），不新增“再 drop”迁移。
21. [x] **模型可用性门提取**：`resolveAvailableModels → find → throw model.notAvailable → createChatModelHandle` 已在 chat / regenerate / compress 三处重复。在 `src/server/ai/model-resolution.ts` 旁新增 `requireModelForActor({ providerConfigId, modelId }, actor)`（抛 `model.notAvailable`，返回 handle），三处改调用。
22. [x] **折叠块原语**：`MessageItem.tsx` 的 `TranslationBlock` 与 `MessageList.tsx` 的 `CompressionSummary` 各自手写 chevron + `aria-expanded`/`aria-controls` + `grid-rows-[1fr]/[0fr]` + `inert`。新增 `src/components/chat/CollapseBlock.tsx`（`label` / `ariaLabel` / `defaultOpen` / 样式透传 / children），两处改用它；`ToolCallShell` 本轮不动（清单外）。
23. [x] **闪动文本样式去重**：渐变 shimmer class 字符串出现三处（`MessageItem` 译文占位、`MessageList` 压缩中提示、既有“思考中”行）。提取为共享常量/组件后三处复用。
24. [x] **MessageList 压缩 props 合并**：`summaryUpToMessageId` / `summaryUpToGroupId` / `summaryText` / `compressingHistory` 四个并列 props 合并为一个 `compression` 对象（ChatView 传入处同步）。
25. [x] **`compressTopic` 返回 `void`**：客户端唯一的调用方丢弃响应。改为不解析响应体，删除 `compressTopicResponseSchema`；服务端路由响应不变（其他客户端仍需要）。
26. [x] **`withTranslation` 去泛型**：`ChatView` 的 `mergeTranslation<T>` + `as T` 改为非泛型 `(entry: ChatUIMessage) => ChatUIMessage`，两处 map 复用。
27. [x] **目标语言表去 cast**：`TRANSLATE_TARGET_LANGUAGE_CODES` 的 `as [T, ...T[]]` 改为先声明 `as const` 代码元组、再由它派生 `{ code, nativeName }` 列表（单一事实来源，无断言）。
28. [x] **`useTopicDetail` 去掉占位 key**：`topicKeys.detail(topicId ?? "none")` 与 `enabled: Boolean(topicId)` 重复，直接传 `topicId`。
29. [x] **回归**：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿；行为等价性由既有测试覆盖（译文块折叠、压缩总结面板、压缩中提示、压缩锁定、自动触发）。

**拒绝项**：`ChatView` 每次发送后无条件 `invalidateQueries(topic detail)` 的“可优化点”不采纳——正确收敛需要服务端在流式 metadata 里新增“本轮发生了压缩”标志（架构 #28 metadata 整块替换），为省一次单行 GET 而新增跨层字段，复杂度高于收益。保持现状。

## 风险文件与回滚点

- `src/app/api/chat/route.ts`（核心聊天路由，改动需最小化、靠前早返回）——回滚点 1：完成步骤 1-3（纯新增）后先跑全量测试。
- `src/server/ai/instructions.ts`（规则 #109 敏感）——只加可选参数，不改既有行为。
- 前端改动（步骤 7-9）独立于服务端，可单独验证。

## 评审门

- 实现子代理不得修改 spec 文档、不得做清单外重构（项目规则 #102）。
- 完成后由 trellis-check 全量验证。

## 第三轮补记（主会话）

- 26 项的裁决：子代理为避免 `as T` 把 `setQueryData` 的泛型放宽成了 `{ messages: ChatUIMessage[] } | undefined`（清单外放宽）。主会话改为把加宽**收敛到 API 边界**：`listTopicMessages` 声明返回 `ChatHistoryData`（仍用 `chatMessagesResponseSchema` 解析），`ChatHistoryData` 在 `src/lib/schemas/chat.ts` 单点定义（`lib/` 不得反向依赖 components），`ChatView` 用 `setQueryData<ChatHistoryData | undefined>` + 非泛型 `mergeTranslation`。无线程内类型撒谎、无 `as`。
- 21 项返回 `{ selected, handle }`（原清单写“返回 handle”）——chat/regenerate 还需要 `contextTokens`/`inputModalities`，接受。
- 拒绝项（每次发送后的 topic detail 失效化）保持现状，理由见上节。
- 第三轮结束后重跑：`pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿（142 files / 1201 tests）。

- 第三轮 check（F1/F2）后补：`ChatHistoryData` 从 `use-chat-history.ts` 移到 `src/lib/schemas/chat.ts`（避免 `lib/api` 依赖 component 模块），`listTopicMessages` 直接用该别名；删除无人引用的 `TranslateTargetLanguage` 导出。再跑 typecheck/lint 绿。
