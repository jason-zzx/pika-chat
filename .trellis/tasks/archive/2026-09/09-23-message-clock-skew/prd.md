# PRD: 统一消息 createdAt 时钟来源

## 背景

话题 `tpc_7OkWvHrjaUi7` 的消息列表顺序倒置：图片生成的 assistant 消息（created_at 05:18:29.855）排在了它要回答的 user 消息（05:18:30.322）之前。

根因：两类消息的 `created_at` 来自两个独立时钟——

- user 消息：`appendUserMessage` 不传值，走 DB `defaultNow()`（Docker 容器内 Postgres 时钟）
- assistant 消息：固定传应用侧 `new Date()`（流式 `streamStartedAt` / 图片 `generatedAt`，Node 进程时钟）

WSL2/Docker 时钟漂移（实测当前偏差 ~366ms，方向会随休眠恢复跳变）使 user 行的时间戳晚于 assistant 行，`listTopicMessages` 按 `created_at, id` 排序即倒置。

## 需求

- R1: 同一 topic 内所有 `chat_messages.created_at` 统一来自 Node 应用进程时钟。
- R2: `appendUserMessage` 接受可选 `createdAt` 参数；`/api/chat` 的两个调用点（流式路径、图片生成路径）在请求处理早期捕获一次时间并传入。
- R3: assistant 侧行为不变——`streamStartedAt` / `generatedAt` 语义（回放与直播时间一致）保持。
- R4: 不引入 Temporal polyfill 等新依赖；继续使用 `new Date()`。
- R5: 单实例部署前提下成立（多实例时钟漂移不在本任务范围）。

## 验收标准

- A1: 同一请求内 user 消息 created_at ≤ assistant 消息 created_at（代码顺序保证，单一时钟）。
- A2: `listTopicMessages` 返回顺序与对话实际顺序一致。
- A3: 现有测试通过；新增/调整测试覆盖"user 传入 createdAt 被持久化"。

## 非目标

- 更换日期库 / Temporal 迁移。
- 修复已存在的历史数据（仅防止新增倒置）。
- 多实例部署的时钟同步。
