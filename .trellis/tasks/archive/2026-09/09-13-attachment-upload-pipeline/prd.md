# 附件上传管道：env 大小上限、presigned 直连与 Claude 孤儿清理

父任务：.trellis/tasks/09-13-chat-attachments-phase3（范围决定 A-E 全部拍板，本任务 = C+D+E，纯后端管道，零 UI）

## Goal

1. **D**：单文件上传上限由环境变量控制，默认 20MB，最大可配 100MB。
2. **E**：presigned URL 客户端直连上传，环境变量开关，默认关闭（现状服务端中转）；仅 S3 后端可用。
3. **C**：Claude Files API 孤儿文件全自动清理——本地删除联动供应商侧删除 + 有界重试，零 UI。

## Background / Confirmed Facts

代码现状（2026-09-13 核实）：

- 上传链路：`POST /api/files`（src/app/api/files/route.ts）formData → `uploadFile()`（src/server/files/file.service.ts:192）整 Buffer 写存储、插行、`extractAndCache` 上传时抽取（memory #49）。上传成功后同请求调 `sweepOrphanFiles`。
- 限制常量：src/lib/files/constants.ts `MAX_FILE_BYTES = 20 * 1024 * 1024`、`MAX_FILE_SIZE_LABEL`、`MAX_ATTACHMENTS_PER_MESSAGE = 5`；客户端 composer（src/components/chat/use-composer-attachments.ts）用 MAX_FILE_SIZE_LABEL 做预检提示。
- 存储：src/server/files/storage.ts `FileStorage` 接口（put/get/delete 整 Buffer）；`S3_BUCKET` 非空切换 S3 实现（memory #71）；`src/instrumentation.ts` 启动时校验 env + 存储可用（memory #73）。
- 删除端点已存在：`DELETE /api/files/[id]` → `deleteFile(id, actor)`（被 composer chip 移除使用，src/lib/api/files.ts）；三个删除路径 `deleteFile` / `deleteFilesIfUnreferenced` / `sweepOrphanFiles` 均在 file.service.ts，后两者 select 只取 id+storageKey（C 插桩需补 providerReferences 列）。
- Files API 引用：src/server/ai/provider-files.ts `ensureProviderReference`，引用存 `files.providerReferences[configId]`，claude 的 `expiresAt` 恒 null；`createFilesApi(endpoint)`（src/server/ai/provider-factory.ts:109）只支持 google/claude；provider.service.ts 有 `decryptSecret` 与按 id 加载 config 的既有路径。
- env 管理：src/server/env.ts zod  schema 集中声明。
- 业界教训（LobeChat GHSA-wrrr-8jcv-wjf5）：不能信客户端自报文件大小，complete 时必须以存储侧实际元数据为准。

## Requirements

### R1（D）env 控制大小上限

- 新增 env `FILE_UPLOAD_MAX_MB`（整数，缺省 20）：合法范围 1–100，超出范围（含 >100）时启动 fail-fast（与 memory #73 口径一致，在 env 校验层拒绝）。
- 服务端上传校验（`uploadFile` 与 presigned complete）改为读 env 值，不再用编译期常量 `MAX_FILE_BYTES`。
- 客户端预检不再依赖编译期 label：新增轻量端点返回当前上限（见 R2 的 limits 端点），composer 拉取失败时回落 20MB 静态默认。
- 上限收紧后已存在的超限存量文件不受影响（只约束新上传）。

### R2（E）S3 直连存取：presigned 上传 + 302 下载（默认关）

- 新增 env `S3_DIRECT_ACCESS`（真值开关，缺省关）。开启但 `S3_BUCKET` 未配置 → 启动 fail-fast（本地磁盘无直连语义，静默回落会造成部署行为分歧）。
- 开启时**上传**流程改为三段：
  1. `POST /api/files/presign`（认证，body: filename + mediaType）：类型白名单校验 → 生成 fileId/storageKey → 插入 DB 行（sizeBytes=0、extractionStatus=none，pending 语义，24h orphan sweep 天然回收未完成上传）→ 返回 S3 presigned POST（policy 含 `content-length-range` 1..maxBytes，S3 侧强制大小）。
  2. 客户端表单直传 S3。
  3. `POST /api/files/complete`（认证，body: fileId）：HeadObject 取**实际大小**（拒绝信任客户端自报）→ 超限则删对象删行并报错 → 更新行 → 服务器 `storage.get` 拉字节执行既有 `extractAndCache`（保持上传时抽取语义）→ 返回与现状 `uploadChatFile` 同形的响应。
- 开启时**下载/预览**：`GET /api/files/[id]` 保持归属校验（他人 id 仍 404），通过后不再中转字节，而是签出 presigned GET（含 `response-content-type` 与 `response-content-disposition` 覆盖，inline/attachment 语义与现状一致）并返回 302；客户端零改动（`<img>`/`<audio>`/`<video>`/新标签页自动跟随重定向），且获得 S3 原生 Range 支持。关闭时维持整 Buffer 中转。
- 客户端模式发现：`GET /api/files/limits` 返回 `{ maxFileBytes, maxAttachmentsPerMessage, directUpload }`；composer 据此选择直连或中转，拉取失败回落中转 + 20MB 预检（下载重定向对客户端透明，无需客户端感知）。
- 关闭时全链路行为与二期完全一致（presign/complete 端点 404，下载中转）。

### R3（C）Claude 孤儿文件自动清理

- provider-files.ts 新增 `deleteProviderFileReferences(file)`：遍历 `file.providerReferences` 中 `expiresAt === null` 的条目（= claude），按 configId 加载 endpoint（config 已删除 → 等同 401/403：放弃 + warn），调 Anthropic REST `DELETE /v1/files/{id}`；best-effort，任何失败不阻塞本地删除。
- 结果分类（与二期 uploadStatus 口径一致）：成功/404 → 了结；401/403/config 失联 → 放弃 + warn 日志；429/5xx/网络 → 写入待删重试表。
- 新增表 `provider_file_delete_retries`：providerConfigId、providerFileId、attempts、nextRetryAt、lastStatus、createdAt；`sweepOrphanFiles` 末尾处理全表到期条目（nextRetryAt ≤ now，跨用户），指数退避 1h→4h→12h→24h→48h，**最多 5 次**后放弃 + warn 日志。
- 三个本地删除路径（`deleteFile` / `deleteFilesIfUnreferenced` / `sweepOrphanFiles`）在删除本地行后调用 `deleteProviderFileReferences`；后两者的行查询补 `providerReferences` 列。
- 不做全量对账（不调 `GET /v1/files`）；无引用则无 API 调用。

## Acceptance Criteria

- [ ] env 缺省时上传链路与二期完全一致：20MB 上限、服务端中转、presign/complete/limits 中端点不影响现状（direct 关时 presign/complete 404）。
- [ ] `FILE_UPLOAD_MAX_MB=50` 时 30MB 文件上传成功；>50MB 被 400 拒绝且错误提示含当前上限；`FILE_UPLOAD_MAX_MB=101` 启动即报错。
- [ ] `S3_DIRECT_ACCESS=1` 且无 `S3_BUCKET`：启动报错；有 S3 时：composer 走 presign→直传→complete，上传成功且抽取结果随响应返回（composer chip 显示解析状态），消息发送后附件可用。
- [ ] direct 开时 `GET /api/files/[id]` 归属校验后返回 302 到 presigned GET（inline/attachment 与 Content-Type 语义与中转一致）；他人 id 仍 404 且不会产生签名 URL；direct 关时该端点行为与二期一致（中转字节）。
- [ ] 直连模式 complete 时 S3 实际大小超限：对象与 DB 行被清除并报错；presign 后未完成直传的行 24h 后被 orphan sweep 回收。
- [ ] 含 claude 引用的文件经三条路径删除后，Anthropic 侧收到对应 DELETE（单测 mock 验证调用参数）；google 引用不触发任何删除调用。
- [ ] 供应商删除 429/5xx 时引用入重试表；sweep 触发重试，5 次后放弃；404/401/403/config 失联直接了结不入队（或入队后立即出队）。
- [ ] 一、二期既有测试全部通过。

## Out of Scope

- 附件管理页、配额（兄弟子任务）。
- 全量 `GET /v1/files` 对账 UI / 脚本（父任务拍板砍掉；存量孤儿手动清理）。
- 本地磁盘后端的伪直连。
- 上传进度条 UI 改造（直连下 XHR 自带进度，composer 复用现有状态即可，不新增进度 UI）。

## Open Questions

（无）
