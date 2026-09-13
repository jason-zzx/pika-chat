# 技术设计：附件存储配额

## 1. 架构与边界

```
src/server/db/schema/app-settings.ts   + fileStorageQuotaBytes (bigint, nullable)
src/server/db/schema/auth.ts           users + fileQuotaBytes (bigint, nullable)
src/lib/schemas/instance-settings.ts   + fileStorageQuotaMb (number|null) 输入 schema
src/server/services/instance-settings.service.ts  读写扩展
src/server/files/quota.ts              新：effectiveQuota / usageBytes / assertQuota
src/server/files/file.service.ts       uploadFile + completeFile 插桩 assertQuota
src/server/files/limits.ts（子任务1）   limits 端点负载加 usedBytes/quotaBytes
src/app/api/admin/users/[userId]/quota/route.ts   新 PATCH（按用户覆盖）
src/components/admin/                  全局默认卡片 + 用户编辑配额字段
```

依赖：子任务1（attachment-upload-pipeline）先行——uploadFile 的动态上限改造与 completeFile 在其内落地，本任务在其上插桩。

## 2. 数据模型

```ts
// app-settings.ts
fileStorageQuotaBytes: bigint("file_storage_quota_bytes", { mode: "number" })
  .default(5368709120),   // 全局默认 5GB（拍板 2026-09-13）；null = 不限（管理员清空）

// auth.ts users
fileQuotaBytes: bigint("file_quota_bytes", { mode: "number" }),  // null = 跟随全局
```

- bigint mode:"number"：5GB（5368709120）远在安全整数内。
- migration：`pnpm db:generate`；app_settings 存量单行由列默认值自动获得 5GB；users 存量行 null = 跟随全局。即默认部署形态从「无限制」变为「全局 5GB」。

## 3. 服务端配额判定（src/server/files/quota.ts）

```ts
export async function effectiveQuotaBytes(actor): Promise<number | null>
// users.fileQuotaBytes ?? appSettings.fileStorageQuotaBytes ?? null（= 不限；默认 5GB）

export async function usageBytes(userId): Promise<number>
// select coalesce(sum(size_bytes), 0) from files where user_id = ?

export async function assertUploadQuota(actor, incomingBytes): Promise<void>
// quota === null → 放行
// used + incoming > quota → AppError("QUOTA_EXCEEDED", 413, "file.quotaExceeded",
//   { used: formatBytes(used), quota: formatBytes(quota) })
```

- 错误 detail 给**格式化后字符串**（与既有 `file.tooLarge` 的 `limit` detail 一致，i18n 插值）。
- 413 Payload Too Large 语义贴切；AppError 新增错误码（error-handling spec 规范）。
- 竞态（并发上传同时过检）可接受：配额是运营约束不是精确账本，超出量至多 N×maxFileBytes，不引锁。

## 4. 插桩点

- `uploadFile`：分类与大小校验后、`storage.put` 前调 `assertUploadQuota(actor, data.byteLength)`。
- `completeFile`（子任务1）：拿到 actualSize 后、更新行前调 `assertUploadQuota(actor, actualSize)`；超限路径与大小超限共用清理（删对象+删行）。
- `presignFile`：不检查（无真实大小）；文档化该语义。
- `GET /api/files/limits` 响应扩展：`{ maxFileBytes, maxAttachmentsPerMessage, directUpload, usedBytes, quotaBytes }`（quotaBytes 可 null）。schema（src/lib/schemas/file.ts 或新 file-limits schema）同步。

## 5. 管理配置链路

### 全局默认（复用 instance-settings 链路）

- instanceSettingsSchema 加 `fileStorageQuotaMb: number | null`（非负整数；null = 不限）。
- `updateInstanceSettings` / `readSettingsRow` 扩展该列（MB→bytes 转换在服务层，DB 存 bytes）。
- UI：/settings/users 页 RegistrationToggle 旁加 `StorageQuotaCard`（SettingsCard 原语）：number input（MB）+ 留空即不限 + 保存调既有 PATCH /api/admin/settings。

### 按用户覆盖（新端点）

- `PATCH /api/admin/users/[userId]/quota`：requireAdmin；body `{ quotaMb: number | null }`（zod 非负整数或 null）；更新 users.fileQuotaBytes；目标用户不存在 → 404；返回 `{ userId, quotaBytes }`。
- AdminUsersScreen 用户编辑对话框加「存储配额 (MB)」字段，留空 = 跟随全局默认，保存时调新端点（与 better-auth 调用并行/串行均可，错误经 apiErrorMessage 管道）。
- 管理员在用户列表看到每用户有效配额：listUsers 响应不含自定义列 → AdminUsersScreen 的表格数据来源若是 authClient.admin.listUsers，需要并行拉取自建 `GET /api/admin/users/quotas`（轻量 map）或接受编辑时才显示。实现时从简：**编辑对话框内加载并显示当前覆盖值**（打开时 GET 一次），列表不新增列。

## 6. 前端规范约束

- SettingsCard/SettingsSection/SettingsRow 原语（memory #42/#43）；数字输入用受控 input，非受控原生 checkbox 类禁忌不适用。
- i18n：所有文案走 next-intl（Settings.Users.* / settingsNav 无需变）；JSX 事件处理器内的复用字面量提升模块常量（memory #45）。
- 移动端可用（memory #15）：对话框表单无 hover-only 交互。

## 7. 关键取舍记录

1. **全局默认挂 app_settings 而非新表/新端点**：现成单行表 + PATCH 链路就是为实例级开关设计的，零新架构。
2. **默认 5GB 而非不限**（拍板 2026-09-13）：配额的意义是让存储增长有预期，默认不限等于默认没有该能力；列默认值让存量部署 migration 后自动获得 5GB，管理员可清空回到不限。null = 不限 / 跟随默认的三态语义保留，比 0 或 -1 哨兵直白；UI 层把「留空」映射为 null。
3. **presign 不预检配额**：无真实大小可查；complete 一道闸统一判定，清理路径与大小超限复用。代价是超限用户白传一次到 S3，可接受。
4. **用量含未引用行**：用户视角「我的附件占了多少」应含暂存未发送的；pending 行 sizeBytes=0 不扭曲统计。
5. **不做并发锁/预扣**：运营约束语义，宁可轻微超发不要复杂度。
6. **列表不新增配额列**：authClient.admin.listUsers 不含自定义列，为展示加并行查询不值；编辑对话框内展示足够。

## 8. 测试策略

- quota.ts 单测：双 null 不限 / 仅全局 / 仅覆盖 / 覆盖优先 / 超限 413 边界（used+incoming == quota 放行）。
- file.service 集成测试：uploadFile 超限拒绝且存储无残留；completeFile 超限清理（mock storage）。
- 端点测试：PATCH quota 的 authz（非管理员 403、目标不存在 404、负数 400）；instance-settings 扩展读写。
- 回归：既有全量。

## 9. 运维与回滚

- 回滚 = revert；两列留存为死列无害。
- 回滚前若已有部署依赖 5GB 默认，注意回滚即回到无限制。
