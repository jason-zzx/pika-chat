# 话题与消息全文搜索

## Goal

侧边栏提供全局搜索入口：对当前用户的**话题标题**与**消息文本内容**做全文匹配，结果列表点击后跳转到对应话题并滚动定位到目标消息。

## Background（代码证据）

- 数据模型：`topics`（经 `assistantId` 归属用户，`src/server/db/schema/assistant.ts`）；`chat_messages.parts` 为 jsonb UIMessage parts，文本在 `type="text"` part 的 `text` 字段（`src/server/db/schema/chat.ts`）。消息有多版本（`groupId` + `isSelected` 唯一部分索引）。
- 归属校验惯例：service 层用 `assistants.ownerId = actor.userId` 内连/子查询过滤（`topic.service.ts` `ownedAssistantIds`、`findTopicForActor`）。
- 滚动定位已就绪：`MessageList.scrollToMessage(key)` 按 `[data-message-key]` 查找，key = `metadata.groupId ?? message.id`（`MessageList.tsx` L486/L567）；`ChatView.handleSelectMessage`（L1168）是现成调用先例（ChatMapDialog）。
- 消息无分页：`topics/[id]/messages/route.ts` 全量返回，定位无需额外加载。
- 话题页：`assistant/[assistantId]/[topicId]/page.tsx` 服务端校验归属后渲染 `ChatView`，未消费 searchParams。
- 侧边栏：`AppSidebar` → `AssistantTree`（`SidebarHeader` 下为树形内容，分 root / assistant / topic 三态 pane）。
- 已有 react-query（`@tanstack/react-query`）、Dialog/Input UI 组件、i18n 双文件（`messages/en.json` / `zh-CN.json`）。

## Key Decisions

- **匹配方式 = Postgres `ILIKE`**，不引入 pg_trgm / tsvector / 外部引擎（YAGNI，数据量为单用户级）。
- **消息内容匹配用 `jsonb_array_elements(parts)` 精确取 text part**，不用 `parts::text`（避免 JSON 键名英文造成误匹配）。`%` / `_` / `\` 转义。
- **只搜 `isSelected = true` 的版本**，未选中版本是隐藏替代答案，搜出来跳转会落到别的内容上。
- **结果分两组**：话题标题命中 + 消息内容命中，各上限 20 条，按 `updatedAt` / `createdAt` 倒序。摘要在 app 侧从 parts 提取（命中行 ≤20，成本有界），窗口 ±60 字符。
- **UI = 侧边栏固定搜索输入行**（SidebarHeader 之下、树之上，非 settings pane 常驻）：输入即查（300ms 防抖 + react-query），内容区切换为结果列表，清空/Esc 恢复树。不做 cmdk 弹窗（无 cmdk 依赖，不新增）。
- **跳转 = `/assistant/{assistantId}/{topicId}?m={groupId}`**：ChatView 消费一次 `m` 参数，消息加载后调 `scrollToMessage` 并短暂高亮目标行，随后从 URL 抹掉参数（避免刷新重复跳）。
- **鉴权与配额**：走既有 `resolveActor`；只搜自己的数据；不做限流（自有数据、查询有界）。

## Requirements

- R1 `search.service.ts`：`searchForActor(actor, query)` 返回 `{ topics: TopicHit[], messages: MessageHit[] }`；TopicHit = topicColumns + assistantId；MessageHit = `{ messageId, groupId, topicId, assistantId, topicTitle, role, snippet, createdAt }`；ILIKE 转义；只命中自己的数据；消息仅 `isSelected`。
- R2 `GET /api/search?q=`：actor 鉴权（未登录 401），`q` trim 后为空返回空结果，超限截断；zod schema 放 `src/lib/schemas/search.ts`。
- R3 侧边栏搜索 UI：输入行常驻（非 settings pane），防抖查询，结果分组渲染（话题组 / 消息组，消息带话题标题 + 摘要高亮词可加粗），点击话题命中 → 话题页；点击消息命中 → 话题页 `?m=groupId`；清空或 Esc 恢复树；折叠为 icon 态时入口退化为搜索图标按钮（点击展开侧边栏并聚焦输入）。
- R4 ChatView：话题页 URL 带 `m` 时，消息加载完成后 `scrollToMessage(m)` + 目标行短暂高亮（约 2s），然后 `router.replace` 去掉 `m`。仅首次挂载消费一次。
- R5 i18n：新增 `Search.*` key，en / zh-CN 同步，无硬编码 JSX 字符串。
- R6 测试：service 集成测试（命中、归属隔离、转义、摘要、isSelected 过滤）；侧边栏搜索组件单测（jsdom，渲染 + 交互主路径）。
- R7（一轮验收反馈）高亮可见性：
  - a) `?m=` 定位的消息行闪烁高亮太弱（`bg-accent/60` 单色洗），重新设计为明确可见的样式（token 体系内：全不透明 accent 底 + 描边/ring 等组合，暗色模式同步核对，`motion-reduce` 保留）；
    - 二轮反馈：accent 系在单色灰主题下与背景/文本同族，依然不可见；琥珀色方案跳戏且 `mark` 内边距把单词撑开。**最终方案：不新增颜色，用每个 preset 自己的 `--primary`（主题注意力色；mono 主题为墨色）。行闪烁 = `bg-primary/8` + `ring-2 ring-inset ring-primary/50`；匹配词 = `<mark>` 无背景：`font-semibold text-primary underline decoration-2 underline-offset-2 decoration-primary/40`（零 padding，不会撑开单词）。彩色主题下高亮带主题色相，mono 主题下靠粗体+下划线+描边轮廓。**
  - b) 话题标题命中也要有 `<mark>` 匹配词高亮（当前只有消息摘要有）；
  - c) 匹配文本必须出现在可见区域内：消息摘要窗口改为非对称（头部上下文 ~16 字符 + 省略号，余量给匹配词之后），保证在 `line-clamp-2` 内匹配词可见；话题标题过长导致匹配词会被 `truncate` 切掉时，标题显示改为围绕匹配词开窗（首尾省略号）。

## Acceptance Criteria

- [x] 输入关键词能在结果中看到自己任意助手下的话题标题命中与消息内容命中，他人数据不出现
- [ ] 点击消息结果跳转到对应话题并滚动定位到该消息（含高亮），URL 恢复干净 —— ChatView `?m=` 消费路径已有组件回归测试（滚动+高亮+去参、重复点击 re-arm、空话题去参）；浏览器可视化验证待做（agent-browser 版本过旧）

> 实证记录 2026-09-29：dev server + 真实 Postgres，临时账号造数后 curl 验证——话题标题命中、消息内容命中、未选中版本排除、reasoning part 排除、`100%` 字面匹配、空 q 空结果、未登录 401，全部通过；验证后测试数据已删、注册开关已还原。
- [x] 含 `%`、`_` 的查询按字面匹配，不报错
- [x] 清空输入或 Esc 后侧边栏恢复原树
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿
