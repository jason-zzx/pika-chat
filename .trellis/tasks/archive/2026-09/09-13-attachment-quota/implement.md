# 执行计划：附件存储配额

前置条件：子任务1（attachment-upload-pipeline）已归档。

## Step 1：schema 与服务层

- [ ] app_settings + fileStorageQuotaBytes（列默认 5GB=5368709120）、users + fileQuotaBytes；`pnpm db:generate` migration
- [ ] src/server/files/quota.ts：effectiveQuotaBytes / usageBytes / assertUploadQuota
- [ ] AppError 新增 QUOTA_EXCEEDED 码（按 error-handling spec）
- [ ] 单测 quota.ts 判定矩阵
- 验证：`pnpm vitest run src/server/files` + `pnpm db:migrate`

## Step 2：上传路径插桩 + limits 透出

- [ ] uploadFile / completeFile 插桩 assertUploadQuota（complete 超限走既有清理）
- [ ] GET /api/files/limits 响应 + schema 扩展 usedBytes / quotaBytes
- [ ] i18n：file.quotaExceeded 文案（含 used/quota 插值），注意 memory #45
- [ ] 集成测试：中转超限无残留、直连超限清理、限内不受影响
- 验证：`pnpm vitest run` + `pnpm tsc --noEmit`

## Step 3：管理员配置链路

- [ ] instanceSettingsSchema + service 扩展（MB↔bytes 转换在服务层）
- [ ] PATCH /api/admin/users/[userId]/quota 端点（requireAdmin、zod、404/403/400 形态）
- [ ] 端点测试：authz 矩阵
- 验证：`pnpm vitest run`

## Step 4：管理 UI（/settings/users）

- [ ] StorageQuotaCard（全局默认，SettingsCard 原语）
- [ ] AdminUsersScreen 用户编辑对话框加配额字段（打开时 GET 当前覆盖值，保存调新端点）
- [ ] lib/api 客户端函数 + i18n key
- 验证：`pnpm tsc --noEmit` + `pnpm lint` + 手测配置流转（全局/覆盖/清空）

## Step 5：全量 gate

- [ ] `pnpm vitest run` 全量 + `pnpm tsc --noEmit` + `pnpm lint`
- [ ] 手测矩阵：默认 5GB 下正常使用 / 全局改 100MB 超限 413 / 覆盖 500MB 优先 / 清空全局回到不限 / direct 模式 complete 超限
- [ ] 对照 PRD Acceptance Criteria 逐条勾验

## 检查点（dispatch 前）

- [ ] prd.md / design.md / implement.md 已评审
- [ ] implement.jsonl / check.jsonl 已策展真实 spec 条目
- [ ] task.py validate 通过
