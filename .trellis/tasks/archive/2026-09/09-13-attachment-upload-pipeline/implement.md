# 执行计划：附件上传管道

实现顺序按「无依赖先行、每步可验证」排列。验证命令见各步；全量 gate 在最后。

## 前置

- [ ] 阅读 .trellis/spec/backend/chat-attachments.md、database-guidelines.md、error-handling.md、logging-guidelines.md、auth-guidelines.md、provider-configs.md
- [ ] 阅读 src/server/files/file.service.ts、storage.ts、src/server/ai/provider-files.ts、src/lib/files/constants.ts、src/lib/api/files.ts、src/components/chat/use-composer-attachments.ts 现状

## Step 1：env 与启动校验（D 的地基）

- [ ] env.ts 加 `FILE_UPLOAD_MAX_MB`（coerce int 1–100，optional）与 `S3_DIRECT_ACCESS`（enum ["1","true"]，optional）
- [ ] instrumentation.ts 追加：direct 开 && 无 S3_BUCKET → throw
- [ ] src/server/files/limits.ts：`maxFileBytes()`
- [ ] 单测：默认值 / 边界 / 非法值 fail-fast
- 验证：`pnpm vitest run src/server/files src/server/env`（路径以实现为准）

## Step 2：D 动态上限接入

- [ ] uploadFile 改动态上限 + 动态 limit label；constants.ts 常量改 DEFAULT_* 语义
- [ ] GET /api/files/limits 端点 + src/lib/api/files.ts fetchFileLimits
- [ ] composer 预检改用拉取的上限（回落默认）
- [ ] 更新受影响的既有单测（MAX_FILE_BYTES 引用点）
- 验证：`pnpm vitest run` 相关文件 + `pnpm tsc --noEmit`

## Step 3：E presigned 后端

- [ ] storage.ts：FileStorage 可选 createPresignedPost + S3 实现（@aws-sdk/s3-request-presigner，content-length-range 条件，ensureBucket 先行）
- [ ] file.service：presignFile（分类校验 + 插 pending 行 + 签名）、completeFile（get 实际字节 → 超限清理报错 → 更新行 → extractAndCache → UploadedFile 响应）
- [ ] 路由：POST /api/files/presign、POST /api/files/complete（direct 关 → 404）
- [ ] 单测 + 集成测试
- 验证：`pnpm vitest run`

## Step 4：E 前端分支

- [ ] lib/api/files.ts：presignChatFile / completeChatFile（fetch 表单直传）
- [ ] use-composer-attachments.ts：directUpload 分支 + 失败回落语义与现状一致
- [ ] i18n key 走既有管道（注意 memory #45：JSX 处理器内字面量提升为模块常量）
- 验证：`pnpm tsc --noEmit` + `pnpm lint`；手测 direct 开（rustfs）与 direct 关回归

## Step 4b：下载/预览 302 直连（S3_DIRECT_ACCESS 开时）

- [ ] storage.ts：FileStorage 可选 `createPresignedGet(key, { expiresSec, responseContentType, responseContentDisposition })` + S3 实现（GetObjectCommand 的 ResponseContentType/ResponseContentDisposition 覆盖）
- [ ] GET /api/files/[id]：归属校验后 direct 开且存储支持 → 302（Cache-Control: private, max-age=300；签名 1h）；否则维持中转
- [ ] 单测 + 路由测试（302 Location 含覆盖参数；direct 关/他人 id 不签名）
- 验证：`pnpm vitest run`

## Step 5：C 删除联动 + 重试

- [ ] schema：providerFileDeleteRetries 表 + `pnpm db:generate` migration
- [ ] provider.service / chat-model 侧导出 loadProviderEndpoint(configId) helper（行 + decryptSecret）
- [ ] provider-files.ts 导出错误分类（uploadStatus 或等效）
- [ ] provider-delete.ts：deleteProviderFileReferences / attemptDelete / enqueueRetry / processDeleteRetries
- [ ] 三删除路径插桩（deleteFilesIfUnreferenced / sweepOrphanFiles 的 select 补 providerReferences）；sweep 末尾跑重试队列
- [ ] 单测：分类矩阵、退避、5 次上限、config 失联
- 验证：`pnpm vitest run` + `pnpm db:migrate`（本地）

## Step 6：全量 gate

- [ ] `pnpm vitest run`（全量，一/二期回归）
- [ ] `pnpm tsc --noEmit` && `pnpm lint`
- [ ] 手测矩阵：direct 关（=二期行为）/ direct 开 + rustfs（上传三段 + 图片/音视频 302 预览）/ FILE_UPLOAD_MAX_MB=50 传 30MB 与 60MB
- [ ] 对照 PRD Acceptance Criteria 逐条勾验

## 风险与回滚点

- Step 2 改动 constants 语义——影响面最大的步骤，先跑全量测试确认引用点。
- Step 5 涉及 migration；回滚 = revert + drop table（死表留存无害）。
- 任何一步失败：该步骤范围内 git checkout 回退，不影响前面已验证步骤。

## 检查点（dispatch 前）

- [ ] prd.md / design.md / implement.md 已评审
- [ ] implement.jsonl / check.jsonl 已策展真实 spec 条目
- [ ] `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-13-attachment-upload-pipeline` 通过
