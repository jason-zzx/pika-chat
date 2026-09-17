# 聊天历史压缩与消息翻译（父任务）

## Goal

为聊天系统增加两项独立交付的增强功能：

1. **会话历史压缩**（子任务 `09-16-history-compression`）：长对话上下文过长时，将早期历史压缩为摘要，控制送入模型的上下文长度与成本。
2. **消息翻译**（子任务 `09-16-message-translation`）：在消息下方操作区（MessageActions）增加翻译图标，点击后从常用语言菜单选择目标语言，对用户提问和助手回复进行翻译并展示译文。

父任务负责需求源、跨子任务验收标准与最终集成评审；实现分别落在两个子任务。

## Confirmed Facts（代码勘察）

- 聊天流式路由 `src/app/api/chat/route.ts`：`history`（UIMessage[]）→ `replayModelMessages`（`src/server/ai/model-messages.ts`，仅薄封装 `convertToModelMessages`）→ `streamText({ messages })`。压缩的自然切入点在 replay 之前对 history 做变换。
- 已有一次性 LLM 侧调用的成熟范式：`src/server/services/title.service.ts`（`generateText` + `createChatModelHandle`），摘要/翻译服务可直接复用该模式。
- 消息操作区为 `src/components/chat/MessageActions.tsx`（复制 / 重新生成 / 删除 / 版本切换 + DropdownMenu），翻译入口按此结构扩展；操作区已遵守触摸设备约束（hover-only 禁止，见项目约束 #15/#16）。
- 消息版本以 `group_id` 分组持久化（架构 #2）；附件、引用、工具调用等 part 类型已在消息中持久化。
- 项目内无任何压缩/摘要机制（仅搜索到 settings files 的批量删除无关命中）。

## Requirements

- R1 子任务可独立规划、实现、检查、归档；压缩依赖的服务若与翻译共享（如通用一次性 LLM 调用 helper），在各自任务文档中写明排序。
- R2 两个功能合入 main 后互不干扰：压缩不改变已持久化的消息内容；翻译不进入模型上下文。

## Acceptance Criteria

- [ ] 两个子任务均通过各自验收并归档。
- [ ] 集成回归：长对话压缩后话题可继续正常对话、重新生成、版本切换；翻译在桌面与触摸设备上均可操作。

## Out of Scope

- 自动全文翻译整个话题（仅按消息手动触发）。
- 翻译语言设置的账户级持久化偏好（除非规划阶段用户要求）。

## Open Questions

（全部已决策，详见各子任务 PRD：压缩 = 自动 80% 阈值 + 手动 Composer 图标、摘要持久化滚动更新、复用当前模型；翻译 = 复用当前模型、固定 8 种语言、译文持久化到消息版本。）
