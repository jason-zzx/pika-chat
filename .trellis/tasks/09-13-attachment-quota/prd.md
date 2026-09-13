# 附件存储配额：总量配额硬拒绝与管理员配置

父任务：.trellis/tasks/09-13-chat-attachments-phase3（本任务 = B，配额模型已于 2026-09-13 拍板）

## Goal

用户级附件存储总量配额：全局默认值 + 管理员按用户覆盖，上传超限时硬拒绝并明确提示当前用量与配额。

## Background / Confirmed Facts

拍板语义（父任务 PRD）：

- 仅**存储总量配额**（用户附件字节数之和）；**超限硬拒绝**；**全局默认 + 按用户覆盖**；不做单文件配额（env 上限覆盖）、不做单日上传量。

代码现状（2026-09-13 核实）：

- 实例级设置走 `app_settings` 单行表（src/server/db/schema/app-settings.ts，现仅 allowRegistration）+ `PATCH /api/admin/settings`（src/app/api/admin/settings/route.ts，requireAdmin）+ `src/server/services/instance-settings.service.ts` + `src/lib/schemas/instance-settings.ts`——全局默认配额直接复用这条链路。
- 用户表 `users`（src/server/db/schema/auth.ts）：role/banned 等自定义列已存在，加列有先例。
- 用户管理 UI：`/settings/users`（src/components/admin/AdminUsersScreen.tsx），用户 CRUD 走 better-auth admin 插件（authClient.admin.*）——**自定义列（配额覆盖）better-auth 不管，需要自建端点**。
- 上传入口（子任务1落地后共三个）：`uploadFile`（服务端中转）、`presignFile` / `completeFile`（直连）。配额检查必须覆盖全部入口——**本任务依赖子任务1先行**（顺序已在父任务 PRD 写明 1→2→3）。
- 用量计算：`SUM(files.size_bytes) WHERE user_id = ?`（files 行即真相，删除联动已保证行与对象同步）。
- pending 行（子任务1 presign 插入的 sizeBytes=0 行）不计用量，24h 内被 sweep 回收，无需特殊处理。

## Requirements

### R1 数据模型

- `app_settings` 加列 `file_storage_quota_bytes`（bigint，nullable，**列默认值 5GB = 5368709120**）：全局默认配额，**默认 5GB**（2026-09-13 拍板）；管理员可修改，置 null = 不限。存量部署 migration 后该行自动获得 5GB 默认。
- `users` 加列 `file_quota_bytes`（bigint，nullable）：**null = 跟随全局默认**。
- 有效配额 = `users.file_quota_bytes ?? app_settings.file_storage_quota_bytes`（默认 5GB）；两者皆 null（管理员主动清空全局）→ 无限制。

### R2 硬拒绝（上传路径）

- `uploadFile`（中转）与 `completeFile`（直连）在写入存储**之前**检查：`used + incoming > effectiveQuota` → `AppError("QUOTA_EXCEEDED", 413, "file.quotaExceeded", { usedBytes, quotaBytes })`，错误提示含当前用量与配额（formatBytes 后）。
- `presignFile` 不知道真实大小，不做检查（complete 时以实际字节数判定，超限删对象删行——与子任务1 design 第二道闸同一位置）。
- 用量统计口径：`SUM(size_bytes)`，含被消息引用的与未引用的全部行（用户视角的"我占了多少存储"）；pending 行 sizeBytes=0 天然为 0。
- 覆盖优先级：按用户覆盖 > 全局默认 > 不限，单测锁定。

### R3 管理员配置 UI（/settings/users）

- **全局默认**：/settings/users 页加配额配置卡片（复用 RegistrationToggle 的卡片模式 + PATCH /api/admin/settings 链路扩展），输入 MB 为单位，初始值 5120（5GB），留空 = 不限（UI 文案明确）。
- **按用户覆盖**：AdminUsersScreen 用户编辑入口加「存储配额」字段（MB，留空 = 跟随全局默认）；新端点 `PATCH /api/admin/users/[userId]/quota`（requireAdmin，zod 校验非负整数 MB 或 null）。
- better-auth admin 插件不感知自定义列，该端点独立实现，不复用 authClient.admin。
- 前端复用 src/components/settings/ 原语（SettingsCard/SettingsSection/SettingsRow），符合 memory #42/#43。

### R4 用量透出（软协作点）

- `GET /api/files/limits`（子任务1）响应扩展 `usedBytes` 与 `quotaBytes`（nullable）字段，供 composer 与管理页（子任务3）展示；子任务3 未落地时仅 composer 错误提示受益。
- 若子任务3 先于此字段落地，管理页用量区块先只显示用量字节数——已在父任务 PRD 记录为非阻塞软协作点。

## Acceptance Criteria

- [ ] 默认（migration 后无配置变更）下全局配额为 5GB：用量 5GB 内的用户上传不受影响，超限被 413 硬拒绝。
- [ ] 管理员将全局默认改为 100MB：用户上传使总量超限时被 413 硬拒绝，错误消息含当前用量与配额；清空全局默认后恢复不限。
- [ ] 给某用户设覆盖 500MB：该用户按 500MB 判定，其他用户仍按全局默认；覆盖设为「跟随默认」后恢复全局判定。
- [ ] 直连模式（子任务1）complete 时同样硬拒绝，且对象与 pending 行被清除。
- [ ] 全局默认与覆盖均可在 /settings/users 页面配置，非管理员访问 PATCH 端点 403。
- [ ] GET /api/files/limits 响应含 usedBytes / quotaBytes。
- [ ] 一、二期及子任务1 既有测试全部通过（注意：既有上传测试若未配置配额，将在 5GB 默认下运行，不应受影响）。

## Out of Scope

- 单文件配额、单日上传量、带宽限制（父任务拍板）。
- 配额使用率的主动告警/通知。
- 管理页前端（子任务3）；composer 内的配额可视化（仅错误提示文本）。

## Open Questions

（无）
