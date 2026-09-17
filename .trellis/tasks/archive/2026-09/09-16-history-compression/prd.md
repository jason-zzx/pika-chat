# 会话历史压缩

## Goal

长对话中，将超过上下文预算的早期历史压缩为摘要后再送入模型，避免上下文溢出并控制 token 成本。用户价值：长话题不会因超出模型上下文窗口而报错或丢失早期关键信息。

## Confirmed Facts（代码勘察）

- 切入点：`src/app/api/chat/route.ts` 中 `replayModelMessages(routedMessages)` 之前对 history 做变换；`replayModelMessages` 位于 `src/server/ai/model-messages.ts`。
- 摘要生成可复用 `src/server/services/title.service.ts` 的模式（`generateText` + `createChatModelHandle`，一次性非流式调用）。
- 消息版本分组（`group_id`）与 `is_selected` 决定实际送入模型的内容（架构 #2），压缩需基于已选版本。
- 附件 part 在 replay 时动态转换为多模态 payload（架构 #48）；压缩摘要为纯文本，需明确附件轮次如何参与摘要。

## Requirements

- R1 **自动压缩**：当送入模型的历史估算 token 数超过当前模型上下文窗口的 **80%** 时，自动将早期历史压缩为摘要，再进行本次模型调用。
- R2 **手动压缩**：Composer 内提供一个图标按钮（提示文本"压缩上下文"），点击后立即压缩当前历史。
- R3 压缩后在消息列表中显示"历史已压缩"的可感知标记（分隔线/提示条）。
- R4 压缩不修改已持久化的原始消息内容。
- R5 **摘要持久化**：话题记录"摘要文本 + 压缩边界（压缩到哪条消息）"，重新加载后继续生效；后续对话仅将边界之后的新消息送入模型；再次超阈值时在旧摘要基础上滚动更新摘要。
- R6 **摘要模型**：复用当前会话正在使用的模型（与标题生成同一模式），零配置。
- R7 **压缩进行中提示**：手动压缩期间，消息列表在压缩边界处（当前历史末尾）显示"正在压缩上下文"闪动提示；成功后该提示被"早期对话已压缩"分隔条替换；失败时提示消失且不残留。
- R8 **Composer 图标与可访问名称统一**：压缩上下文按钮换用语义更贴切的图标（`ListCollapseIcon`，替代 `ShrinkIcon`）；Composer 内所有图标按钮统一同时具备 `aria-label` 与 `title`。
- R9 **压缩总结可折叠展示**：压缩边界处的分隔条可展开查看已压缩的摘要正文，默认折叠；摘要正文由 `GET /api/topics/[id]` 一并透出（`summaryText`）；折叠机制与译文块一致（真实 button + `aria-expanded`/`aria-controls`），触摸可操作。
- R10 **压缩区锁定**：边界消息（含）之前的已压缩历史不可删除、不可重新生成。客户端隐藏相应操作入口；服务端在 `deleteMessage` 与 `resolveRegenerateTarget` 对压缩区内目标返回 `CONFLICT`(409) + `Errors.message.compressedLocked`。

## Acceptance Criteria

- [x] AC1（自动）：构造超过模型 contextTokens 80% 的长对话后发送新消息，服务端先生成并持久化摘要，本次模型调用的 instructions 含摘要、messages 仅含边界之后的内容。
- [x] AC1b（regenerate 对齐）：已压缩话题中重新生成边界之后的消息时，instructions 含摘要、送入模型的历史仅含边界之后的内容。
- [x] AC2（手动）：非草稿话题的 Composer 显示"压缩上下文"图标，点击后话题产生摘要与边界；草稿状态与流式进行中图标禁用。
- [x] AC3（持久化/滚动）：刷新页面后压缩标记仍在；再次超阈值时摘要在旧摘要基础上滚动更新，边界单调后移。
- [x] AC4（标记 UI）：消息列表在边界消息后显示"早期对话已压缩"分隔条。
- [x] AC5（无损）：压缩后 `chat_messages` 原始内容不变，话题内原始消息仍正常渲染。
- [x] AC6（容错）：摘要生成失败时自动触发场景不阻塞本轮对话——已有摘要时沿用已持久化摘要与边界后裁剪；仅从未压缩过的话题退回全量历史。
- [x] AC7：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿。
- [x] AC8（压缩进行中提示）：点击 Composer 压缩图标后，消息列表末尾立即出现闪动的"正在压缩上下文"提示（`role="status"` 可感知，非 hover-only）；成功后提示消失、分隔条出现在新边界消息后；请求失败时提示消失并弹出错误，不遗留残留提示。
- [x] AC9（图标与 title）：压缩按钮图标换为 `ListCollapseIcon`；Composer 内每个图标按钮都能通过 `aria-label`/`title` 得知用途（含附件、搜索模式、聊天地图、展开/收起、发送/停止）。
- [x] AC10（可折叠总结）：压缩边界分隔条可点击展开/收起摘要正文，默认收起；展开后显示服务端持久化的摘要文本；无摘要时分隔条保持纯展示；触摸与键盘可操作。
- [x] AC11（压缩区锁定）：已压缩区内的消息不显示删除与重新生成入口；直接调用 delete / regenerate 接口作用于压缩区内消息时返回 409 `message.compressedLocked`；边界之后的消息行为不变。

## Out of Scope

- 专用摘要模型设置项。
- 精确 tokenizer（采用保守启发式估算）。
- 压缩区内消息的"查看被压缩的原始历史"全文展开（R9 只展示摘要；原始消息仍在本地消息列表中正常渲染）。

