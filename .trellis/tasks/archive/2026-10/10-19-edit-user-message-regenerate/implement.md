# 执行计划：用户消息编辑后重新生成

## 顺序检查清单

1. **Schema**：`src/lib/schemas/chat.ts` — `regenerateMessageRequestSchema` 增加 `edit: chatRequestMessageSchema.optional()`。
2. **服务层**：`src/server/services/message.service.ts`
   - 新增 `appendUserMessageVersion`（事务：deselect siblings → insert；校验目标组为 user 角色）。
   - `rowToChatUIMessage` 移除版本元数据的 assistant-only 门限。
3. **路由**：`src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts` — edit 分支（角色校验 → `resolveOwnedFileParts` → `appendUserMessageVersion` → 重新 `resolveRegenerateTarget(edit.id)`），其余流程不动。
4. **API 客户端**：`src/lib/api/chat.ts` — `regenerateTopicMessage` 请求体类型支持 `edit`。
5. **操作区**：`src/components/chat/MessageActions.tsx` — `onEdit` prop、最左铅笔图标、下拉「编辑」项（user-only）。
6. **编辑器**：`src/components/chat/MessageItem.tsx`（或新 `UserMessageEditor.tsx`）— 编辑态 UI：textarea 预填、附件 chip（复用 `useComposerAttachments` + `AttachmentChip`）、取消/发送、禁用规则。
7. **串联**：`src/components/chat/MessageList.tsx` 透传 props；`src/components/chat/ChatView.tsx` 新增 `handleEditSubmit`（乐观替换 + 占位 + 流式 + 失败回滚 + reseed）。
8. **i18n**：中英 locale 增加编辑相关文案。
9. **测试**：按 design.md §5 补齐服务端集成/单元与组件测试。

## 验证命令

- `pnpm vitest run`（或项目既有 test 脚本）——全量单测/组件测试
- 服务端集成测试：`message.service.integration.test.ts` 相关用例
- `pnpm lint` / `pnpm type-check`（以 package.json 实际脚本为准）
- 手动验证 AC1–AC9（重点：移动端 tap 路径、附件增删、压缩区禁用、失败后恢复）

## 审查关口

- 实现完成后由 `trellis-check` 做全量质量校验（spec 合规、lint、type-check、测试、跨层数据流）。
- 重点自查：事务内 deselect+insert（部分唯一索引）；edit 校验先于任何写入；失败路径无残留占位。

## 回滚点

- 每步可独立 revert；整特性单 commit 落地后可整体 revert（旧代码读取多版本用户组向后兼容，见 design.md §6）。

## 明确不做

- 不做用户版本与 assistant 版本之间的分支追踪（见 prd.md Notes）。
- 不新增端点、不改 composer 主发送流程、不动滚动逻辑。
- 子代理不修改 spec 文档；`chat-message-versions.md` 的同步由主会话在 Phase 3.3 完成。
