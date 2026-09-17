# 会话历史压缩 — 技术设计

## 架构与边界

```
┌ Composer (手动"压缩上下文"图标) ──→ POST /api/topics/[id]/compress ─┐
│                                                                     ▼
└ 自动触发: src/app/api/chat/route.ts ──→ compression.service ──→ topics 表
   (发送前估算, >80% contextTokens)        (摘要生成 + 持久化)     summary_*
                                              │
                                              ▼
                                    generateText + createChatModelHandle
                                    (复用当前会话模型, 同 title.service 模式)
```

**核心原则**：压缩只改变"送入模型的上下文"，绝不修改 `chat_messages` 中的原始消息（PRD R4）。压缩状态（摘要 + 边界）持久化在 `topics` 表。

## 数据模型（Drizzle migration）

`topics` 表新增 3 列（均 nullable，老数据零迁移成本）：

| 列 | 类型 | 含义 |
|---|---|---|
| `summary_text` | `text` | 早期历史摘要（滚动更新，整体替换） |
| `summary_up_to_message_id` | `text` | 压缩边界：该消息（含）之前的历史已被摘要覆盖 |
| `summary_updated_at` | `timestamptz` | 最近一次压缩时间 |

注意：`topicColumns`（schema/assistant.ts）是 `Topic` 共享投影，新增列按需加入查询而非默认投影，避免影响现有 topic 列表接口。

`chat_messages` 不变。

## 服务端流程

新增 `src/server/services/compression.service.ts`：

1. **token 估算** `estimateHistoryTokens(messages)`：无 tokenizer 依赖（package.json 无 tiktoken），采用保守启发式——文本字符数 / 2（CJK ≈ 1 token/字符，英文 ≈ 4 字符/token，取偏保守值），附件 file part 按固定估额计入。高估的代价只是更早压缩，可接受。
2. **有效上下文计算**：`summary` 存在时，上下文 = summary + 边界之后的消息；否则 = 全部历史。
3. **自动触发**（chat route.ts，`resolveAttachmentsForModel` 之前、`listTopicMessages` 之后）：估算「有效上下文 + 新用户消息」> `selected.contextTokens * 0.8` 时执行压缩。
4. **压缩执行** `compressTopicHistory(topicId, upToMessageId, handle)`：
   - 输入 = 旧摘要（如有）+ 旧边界→新边界之间的已选版本消息（`listTopicMessages` 只返回已选版本，天然满足架构 #2）。
   - 附件轮次：只取文本 part + 附件文件名标注，不发送多模态 payload 给摘要模型。
   - 用当前会话模型 `generateText` 一次性生成摘要（提示词：保留关键事实/决定/待办，输出纯摘要文本）。
   - 边界推进到最后一条被压缩的消息，整体替换 `summary_text`（滚动更新）。
   - 失败处理：摘要生成失败 → 记录日志，本次请求按未压缩历史继续（不阻塞对话）；手动触发则返回错误。
5. **摘要注入**：通过 `buildChatInstructions({ ..., historySummary })` 注入 system 层（遵守项目规则 #109：instructions 只能由 buildChatInstructions 组装，该函数增加可选参数）。

## API

- `POST /api/topics/[id]/compress`（手动）：鉴权 + 归属校验（同 topics 既有路由），强制压缩到当前最后一条消息，返回 `{ summaryUpToMessageId, compressedCount }`。无历史可压缩时返回 400。
- `GET /api/topics/[id]`：响应增加 `summaryUpToMessageId`（供客户端渲染压缩标记）。

## 前端

- **Composer 图标**：`Composer.tsx` 工具行增加图标按钮（tooltip/i18n 文案"压缩上下文"），draft 状态（无 topicId）或流式进行中禁用；成功后失效化 topic 查询缓存以刷新标记。
- **压缩标记**：`MessageList.tsx` 在 `summaryUpToMessageId` 对应消息之后渲染分隔条（"早期对话已压缩"样式，muted 分隔线 + 文案）。触摸/桌面均为纯展示，无交互门槛。
- i18n：`Chat.Compression.*` 文案，中英文两份。

## 兼容性与回滚

- 新列全部 nullable，旧话题无摘要时行为与现状完全一致。
- 回滚 =  revert 代码；遗留的 summary 列数据无害（不被读取）。
- 风险点：摘要质量依赖当前模型能力；弱模型摘要丢失信息 → 用户在标记处可感知"已压缩"，原始消息仍在数据库中（不删除），后续如需可扩展"查看原始历史"。

## 测试要点

- 单元：token 估算启发式；压缩边界推进；有效上下文计算（有/无摘要）。
- 集成：`POST /api/topics/[id]/compress` 归属校验与持久化；chat 路由自动触发（mock 估算超阈值）后 instructions 含摘要、messages 只含边界后内容。
