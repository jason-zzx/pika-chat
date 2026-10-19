# 用户消息编辑后重新生成

## Goal

支持就地编辑已发送的用户消息（含操作区编辑图标与下拉菜单项），发送后生成新的消息版本并触发重新生成，assistant 回复也作为可切换的新版本。

## Requirements

### 功能

- R1 用户消息操作区最左侧新增「编辑」图标按钮（铅笔图标），下拉菜单同时新增「编辑」菜单项；两者都进入就地编辑态。仅用户消息可见。
- R2 点击编辑后，消息气泡就地切换为编辑器：预填当前版本文本，展示当前版本的附件 chip（可删除、可新增），底部出现「取消」和「发送」按钮。
- R3 附件可编辑：沿用 composer 的上传/校验/限额规则（上传走既有 `POST /api/files`，chip 展示既有解析错误与配额提示）。附件与文本本就是同一条消息的 parts（`appendUserMessage`），不存在分离传输。
- R4 「取消」退出编辑态，恢复展示原消息，无任何服务端写入。
- R5 「发送」提交编辑：
  - 原用户消息不被修改，编辑内容作为**同一版本组的新版本**写入（`group_id` 不变，`is_selected` 切到新版本），版本切换器可在用户消息上切换历史版本。
  - 随后自动触发重新生成（视作「重新生成」）：使用 **composer 当前选中的模型/助手/搜索模式/推理档位**（与现有重新生成按钮一致），新 assistant 回复进入下方既有回复的版本组（无既有回复则开新槽位），可切换。
  - 编辑发送后其后的消息不被截断（沿用产品决策 D1）。
- R6 发送时立即反馈：编辑态退出、列表就地展示新版本用户消息、下方回答槽位立即出现 thinking shimmer 占位（与 R7 重新生成一致的即时反馈契约）。
- R7 内容未变化也允许发送（等价于一次纯重新生成）；但「无任何文本且无附件」不允许发送（发送按钮禁用），与 composer 规则一致（`chatRequestMessageSchema` 允许仅附件消息）。
- R8 压缩锁定（compressedLocked）的用户消息禁止编辑（编辑会触发重新生成，压缩区内重新生成被 PRD R10 拒绝）；流式进行中（chat 或 regen 任一 inFlight）禁止进入编辑态。
- R9 移动端：编辑入口不依赖 hover，沿用消息点按显现操作区（tap-reveal）路径；编辑器内按钮均为可点按元素。

### 非功能 / 约束

- C1 服务端写入选中版本切换必须事务化：先取消同组 siblings 的 `is_selected` 再插入新行，满足部分唯一索引 `chat_messages_selected_version_idx`。
- C2 编辑提交中的附件必须先经 `resolveOwnedFileParts` 校验归属并规范化，再持久化新版本（与 /api/chat 相同顺序，伪造/他人 file id 不得留下写入）。
- C3 编辑持久化发生在流式生成之前；若之后的流式失败，已持久化的用户新版本保留，assistant 侧按现有失败语义落一个 failed 版本（与重新生成失败一致，不回滚用户编辑）。
- C4 版本元数据（`groupId`/`versionIndex`/`versionCount`/`versionIds`）从「仅 assistant 行」放开到用户行（`rowToChatUIMessage` 的角色门限移除）；`.trellis/spec/backend/chat-message-versions.md` 在收尾阶段同步更新。
- C5 不新增端点：复用 `POST /api/topics/[id]/messages/[messageId]/regenerate`，请求体扩展可选 `edit` 负载。

## Acceptance Criteria

- [ ] AC1 用户消息操作区最左出现编辑图标，下拉菜单出现「编辑」；assistant 消息不出现编辑入口。
- [ ] AC2 点击编辑后就地出现编辑器（预填文本 + 附件 chip + 取消/发送）；取消后恢复原样且无网络写入。
- [ ] AC3 发送编辑后：该用户消息原地显示新内容并出现版本切换器（如 2/2），可切回旧版本；下方 assistant 回复立即进入 shimmer 占位，流式生成新版本，结束后版本切换器可切换新旧回复。
- [ ] AC4 编辑中增删附件生效：新增附件走既有上传流程并在 chip 显示；删除附件后新版本不再引用；仅附件无文本可发送；空内容发送按钮禁用。
- [ ] AC5 刷新页面后用户消息与 assistant 回复的版本选择状态与服务端一致（`is_selected` 持久化）。
- [ ] AC6 压缩区内消息无编辑入口；流式进行中编辑入口禁用。
- [ ] AC7 重新生成使用 composer 当前选中的模型与参数（与重新生成按钮行为一致）。
- [ ] AC8 编辑提交失败（网络/校验）时：恢复编辑前展示的消息版本与回答，出现可理解的错误提示（`apiErrorMessageFromUnknown` 解析，不渲染原始 JSON）。
- [ ] AC9 移动端 tap 路径可完成「显现操作区 → 编辑 → 发送/取消」全流程，无 hover 依赖。

## Notes

- 关键调研结论：
  - 附件与文本是同一条用户消息的 parts（`appendUserMessage` 持久化 text+file parts），不是分开发送，因此附件可编辑成立。
  - `resolveRegenerateTarget` 已支持 user 目标（取紧随其后 assistant 组或开新槽位）；regenerate 路由与客户端 `regenerate-stream.ts` 占位/折叠逻辑可直接复用。
  - `rowToChatUIMessage`（message.service.ts:103-107）当前把版本元数据门限在 assistant 行，需放开。
  - 版本切换 UI（MessageActions）与 `select` 端点本身角色无关，用户消息获得元数据后切换器自然可用。
- 版本组之间不做分支追踪：切回旧的用户版本时，下方 assistant 组仍显示其当前选中版本（可能是回答新用户版本的那条）。与现有「重新生成不截断后续消息」（D1）一致，属接受的简化。
