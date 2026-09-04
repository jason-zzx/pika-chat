# Implement: chat message regenerate and delete

按序执行；每步完成后跑对应校验。读写规范见 `implement.jsonl` 所列 spec。

## Checklist

1. **Schema + migration**
   - `src/server/db/schema/chat.ts`：`chatMessages` 加 `groupId`（text）、`isSelected`（boolean default true），部分唯一索引（groupId where is_selected）、`(topicId, groupId)` 索引。
   - `pnpm db:generate` 生成迁移；在迁移 SQL 的列添加之后、`not null` 之前补 backfill `UPDATE chat_messages SET group_id = id`（迁移未被应用过，允许编辑）。
   - 校验：`pnpm db:migrate` 从空库起干净应用；`pnpm db:generate` 不再产生 diff。
2. **metadata schema**（`src/lib/schemas/chat.ts`）
   - `chatMetadataSchema` 加 `groupId` / `versionIndex` / `versionCount` / `versionIds`（全 optional）；新增 regenerate 请求 body schema。
3. **service 层**（`src/server/services/message.service.ts`）
   - 分组版 `listTopicMessages`（选中版本视图 + 版本元数据 + 兜底逻辑）。
   - `appendAssistantMessage` 支持 `groupId`（事务内翻牌）；`appendUserMessage` 写 `groupId = id`。
   - 新增 `deleteMessage` / `selectMessageVersion` / `resolveRegenerateTarget`。
   - 同步更新 `message.service.test.ts` 并新增分组/删除/选择/目标解析用例。
4. **API 路由**
   - `DELETE /api/topics/[id]/messages/[messageId]`、`POST .../select`、`POST .../regenerate`（流式，`x-pika-stream-id` 响应头，复用 chat route 骨架）。
   - 校验：service/集成测试通过后 `pnpm build` 类型检查。
5. **前端 api 层**（`src/lib/api/chat.ts`）：三个新方法。
6. **ChatView**（`src/components/chat/ChatView.tsx`）
   - regen 状态 + `handleRegenerate`（readUIMessageStream 消费、原位替换/插入、统一收尾 reseed）+ `handleDelete` + `handleSelectVersion` + `handleDeleteRegenerate` + `handleStop` 扩展 + inFlight 互斥。
7. **消息组件**
   - `MessageList` 加 `streamingMessageId`；`MessageItem` 透传版本元数据；`MessageActions` 重排（切换器/重新生成/复制/三点菜单，菜单项按角色区分）。
   - 更新 `MessageActions.test.tsx` / `MessageItem.test.tsx`，新增切换器用例。
8. **全量验证**（见下）。

## Validation Commands

```bash
pnpm test              # vitest projects：unit-node / unit-dom / integration（integration 需 TEST_DATABASE_URL，见 vitest.integration.setup.ts）
pnpm typecheck         # tsc --noEmit
pnpm build             # 构建
pnpm lint              # eslint src
```

人工冒烟（`pnpm dev`）：
- 发两轮对话 → 对第一轮回答重新生成 → 切换器 `2/2` → 切回旧版 → 刷新仍停在旧版 → 发送新消息（旧版进上下文）。
- 删除中间消息、逐条删到空 → topic 保留可继续发。
- 重新生成中途停止 → stopped 版本保留。
- 菜单项按角色正确（user 无"删除并重新生成"）。

## Iteration 2 Addendum (bug fix round)

在步骤 6-7 已完成的基础上修复 prd.md Bug List B1-B6（对应 R7/R8 的完善）：

1. **B1 操作区状态丢失**：`revealed` 状态不应随 message id 变化而重置。方案方向：状态提升到 MessageList/ChatView 层按槽位（groupId 或列表 index）记忆，或 MessageItem 用 groupId 作为 key 的一部分；注意切换版本后消息 id 会变、reseed 会替换数组。
2. **B2 菜单打开时操作区消失**：dropdown 的 open 状态计入 reveal 条件（open 期间强制可见）；排查 focus 移入 portal 菜单导致 focus-within 丢失的路径。
3. **B3**：菜单项加 `whitespace-nowrap`。
4. **B4**：恢复 MessageActions 复制按钮的 copyState → CheckIcon 2 秒反馈（对照 git 中重构前实现）。
5. **B5/R7**：闪动动画加大对比度/幅度使其明显；修复 regenerate 占位逻辑——点击重新生成后**立即**把目标位置替换为空内容的流式消息（闪动出现），而不是等第一个 chunk 才替换。
6. **B6**：新建话题首条回复后立即重新生成 404。先复现定位（见下"手工验证"）：若是 onEnd 持久化竞态，方案方向：动作前确保本地消息与服务端同步（目标 id 不在服务端历史中时先 refetch + reseed 再执行），或服务端 regenerate 对找不到的 messageId 返回可区分错误码由客户端重试一次。

每步仍跑 `pnpm test` / `pnpm typecheck` / `pnpm lint`；组件测试覆盖 B1-B5 的交互用例。

### 手工验证账号

`pnpm dev` 后用 admin / testpass123 登录，模型选 hosted/gpt-5.6-luna。重点路径：新建话题 → 发消息 → 不刷新直接重新生成（B6）；移动端模拟点按操作区/菜单（B1/B2）。

## Iteration 3 Addendum (reveal semantics + two regressions)

对应 prd.md R9-R11 / B7-B9 / AC16-AC18：

1. **B7/R9 点按显示改为单条激活**：`revealed` 状态从 MessageItem 本地提升到 MessageList（或 ChatView）层，记为单一 `revealedKey`（用 groupId ?? id）；点击消息设为当前激活；**取消同条再点收起的 toggle**；点击其他消息自然转移。版本切换器并入 reveal 行（删除多版本常显特判）。menuOpen / copyFeedback 的保活逻辑保留。桌面 hover/focus-within 不变。
2. **B8**：`useChatHistory(topicId)` → `useChatHistory(activeTopicId)`，seed effect / invalidate 同步检查；验证新话题 regen 后切换器立即出现。
3. **B9**：复制降级——`navigator.clipboard?.writeText` 不可用时用隐藏 textarea + `execCommand("copy")`；提取为可单测的 helper（如 `lib/clipboard.ts`），单测覆盖 clipboard 缺失与 reject 两条路径。

仍跑 `pnpm test` / `pnpm typecheck` / `pnpm lint`；更新受影响的组件测试。

## Risky Files / Rollback Points

- `src/app/api/chat/route.ts` 骨架被 regenerate 路由参考/抽取时注意别改动原行为；若抽取共享 helper，先跑现有测试。
- `ChatView.tsx` 改动面最大：`seededHistoryFor` 重置时机错误会导致流式中被 reseed 覆盖——收尾必须等流完全结束（含 onEnd 持久化）；先以 invalidate + 服务端为准，不做乐观版本切换。
- migration 是 rollback point：步骤 1 单独提交（schema+migration 同 commit，见 database-guidelines）。
- `listTopicMessages` 改分组后直接影响 `/api/chat` 上下文构造：先写服务层测试锁定"单版本组输出与旧行为逐条等价"，再做前端。

## Follow-up Before task.py start

- 本清单 + prd.md + design.md 经用户确认。
- `implement.jsonl` / `check.jsonl` 已含真实 spec 条目。
