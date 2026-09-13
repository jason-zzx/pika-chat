# 技术设计：附件上传管道（D env 上限 + E presigned 直连 + C Claude 孤儿清理）

## 1. 架构与边界

```
src/server/env.ts                    + FILE_UPLOAD_MAX_MB / S3_DIRECT_ACCESS
src/instrumentation.ts               + 启动校验（上限范围 / direct 无 S3 报错）
src/lib/files/constants.ts           保留静态默认（客户端回落用），新增 directUpload 默认 false
src/server/files/limits.ts           新：服务端上限读取（env → bytes）
src/server/files/file.service.ts     uploadFile 用动态上限；+presignFile/completeFile；
                                     三删除路径插桩 C；sweep 末尾跑重试队列
src/server/files/storage.ts          FileStorage + 可选 createPresignedPost / createPresignedGet（仅 S3 实现）
src/server/files/provider-delete.ts  新：C 的删除联动 + 重试队列（不放 provider-files.ts：它是发送路径模块，
                                     删除语义独立；复用其 uploadStatus 错误分类则需导出）
src/server/db/schema/file.ts         + providerFileDeleteRetries 表
src/app/api/files/limits/route.ts    新 GET
src/app/api/files/presign/route.ts   新 POST（direct 关 → 404）
src/app/api/files/complete/route.ts  新 POST（direct 关 → 404）
src/lib/api/files.ts                 + fetchFileLimits / presignChatFile / completeChatFile
src/components/chat/use-composer-attachments.ts  上传分支：direct → presign→POST S3→complete；否则现状
```

## 2. env 与启动校验

```ts
// env.ts
FILE_UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).optional()  // 缺省 → 20
S3_DIRECT_ACCESS: z.enum(["1", "true"]).optional()                        // 出现即开
```

- zod 层拒绝越界值（>100 / <1 / 非整数）→ `getEnv()` throw，启动即失败（memory #73）。
- `instrumentation.ts register()` 追加：direct 开且 `S3_BUCKET` 空 → throw。本地磁盘无直连语义，静默回落会让同一 env 在不同部署产生不同行为。

## 3. D：动态上限

- `src/server/files/limits.ts`：`maxFileBytes() = (getEnv().FILE_UPLOAD_MAX_MB ?? 20) * 1024 * 1024`。测试可 mock getEnv（既有模式）。
- `uploadFile` 的 `sizeBytes > MAX_FILE_BYTES` 改为 `> maxFileBytes()`；错误 detail 的 limit label 由 bytes 动态 formatBytes。
- `src/lib/files/constants.ts` 保留 `DEFAULT_MAX_FILE_BYTES`（20MB）与 `MAX_ATTACHMENTS_PER_MESSAGE`：前者只作客户端拉取失败时的回落预检，不再约束服务端。
- 收紧 env 不影响存量文件（只在新上传路径读取）。

## 4. E：S3 直连（presigned 上传 + 302 下载）

### 模式发现

`GET /api/files/limits` → `{ maxFileBytes, maxAttachmentsPerMessage, directUpload }`（directUpload = env 开 && 存储是 S3 实现）。composer hook mount 时拉取并缓存；失败回落 `{ 20MB, 5, false }`。

### 三段流程

```
POST /api/files/presign   { filename, mediaType }
  → requireActor；direct 关 → 404（端点存在性即开关，无需额外错误码）
  → classifyFile 白名单校验（与 uploadFile 同规则，复用）
  → id = newId()；storageKey = userId/id
  → 插入 files 行：sizeBytes = 0、extractionStatus = 'none'  // pending 语义；
    // 24h orphan sweep 天然回收未完成直传（无需新机制）
  → storage.createPresignedPost(key, { maxBytes, expiresSec: 900 })
      S3 实现：@aws-sdk/s3-request-presigner createPresignedPost，
      Conditions: ["content-length-range", 1, maxBytes]  // S3 侧强制，第一道闸
  → 201 { fileId, post: { url, fields } }

客户端：FormData(fields + file) POST 到 post.url（XHR，无 CORS 凭证）

POST /api/files/complete  { fileId }
  → requireActor + 行归属校验（getFileForActor）；direct 关 → 404
  → data = storage.get(storageKey)           // 对象不存在（未直传/直传失败）→ 404 file.uploadFailed
  → actualSize = data.byteLength              // 不信任客户端自报（LobeChat GHSA 教训），
                                              // 也省掉 HeadObject——反正抽取要拉字节
  → actualSize > maxFileBytes() → 删对象 + 删行 + 400 file.tooLarge  // 第二道闸（policy 被绕过的兜底）
  → 更新行 sizeBytes = actualSize
  → extractAndCache（与 uploadFile 同路径，保持上传时抽取语义 memory #49）
  → 返回 UploadedFile（与 POST /api/files 响应同形，前端零分支）
```

### FileStorage 扩展

```ts
export interface FileStorage {
  put/get/delete(...): ...;
  // 仅 S3 实现提供；direct 模式启动校验保证其存在
  createPresignedPost?(
    key: string,
    opts: { maxBytes: number; expiresSec: number },
  ): Promise<{ url: string; fields: Record<string, string> }>;
}
```

`LocalDiskFileStorage` 不实现该可选方法；`S3FileStorage` 用模块级 presigner（`createPresignedPost(client, { Bucket, Key, Conditions, Expires })`），`ensureBucket()` 先行。

### 下载/预览 302 重定向

`S3_DIRECT_ACCESS` 开时，`GET /api/files/[id]` 的流程变为：

```
getFileForActor（归属校验不变，他人 id 仍 404，且不会产生签名 URL）
  → storage.createPresignedGet(key, {
       expiresSec: 3600,
       responseContentType: row.mediaType,            // 白名单类型，inline 不可被诱导
       responseContentDisposition: inline|attachment + filename,  // 与中转语义逐字一致
    })
  → 302 Location: signedUrl
     Cache-Control: private, max-age=300               // 重定向缓存远短于签名过期，杜绝过期 URL 复用
```

- `createPresignedGet` 是 FileStorage 第二个可选方法（`getSignedUrl(client, GetObjectCommand({ ResponseContentType, ResponseContentDisposition }))`），仅 S3 实现；direct 关或本地磁盘 → 维持整 Buffer 中转。
- 客户端零改动：`<img src>`、`<audio>/<video src>`、新标签页导航自动跟随 302；媒体元素无 crossorigin 属性时不受 CORS 约束（直传 POST 仍需 bucket CORS，README 需写明）。
- 收益：字节不流经服务器（带宽/内存卸载）；S3 原生 Range 支持，大视频拖动优于中转。
- 接受的权衡：presigned URL 过期前是 bearer 凭证（标准做法，与 LobeChat 同型）；以 1h 过期 + 302 短缓存收敛；S3 访问日志会记录签名 URL。
- 管理页（子任务3）与消息附件卡透明受益，无需各自改造。

### 前端（最小改动）

- `src/lib/api/files.ts`：`fetchFileLimits()`（失败返回默认）、`presignChatFile()`、`completeChatFile()`。
- `use-composer-attachments.ts`：上传函数分支——`limits.directUpload` → presign → `XMLHttpRequest` 表单 POST（fetch 无上传进度，现状 chip 只有上传中/失败态，XHR 非必须，fetch 亦可；实现时从简用 fetch）→ complete。失败路径任一步出错即 chip 失败态，与现状一致。
- 预检：size > limits.maxFileBytes 时直接 chip 报错（不发请求），label 用 formatBytes 动态值。

## 5. C：Claude 孤儿删除联动 + 有界重试

### 数据模型

```ts
// src/server/db/schema/file.ts
export const providerFileDeleteRetries = pgTable("provider_file_delete_retries", {
  id: text("id").primaryKey(),
  providerConfigId: text("provider_config_id").notNull(),   // 不外键：config 删除不该级联丢队列条目
  providerFileId: text("provider_file_id").notNull(),        // anthropic 侧 file id
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamptz("next_retry_at").notNull(),
  lastStatus: integer("last_status"),                        // 最近一次 HTTP 状态，nullable
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
```

migration：`pnpm db:generate` 一个，无存量数据处理。

### 删除联动（provider-delete.ts 新模块）

```ts
export async function deleteProviderFileReferences(file: FileRecord): Promise<void>
// 永不 throw。遍历 file.providerReferences：
//   expiresAt !== null（google）→ 跳过（48h 自动过期）
//   expiresAt === null（claude）→ attemptDelete(configId, fileId)
//
// attemptDelete:
//   endpoint = await loadProviderEndpoint(configId)   // 新 helper：config 行 + decryptSecret
//   config 不存在 → warn 放弃（失联引用，属存量手动清理范畴）
//   fetch DELETE {baseUrl}/v1/files/{fileId}          // 直连 REST：AI SDK .files() 只有 upload
//     headers: x-api-key, anthropic-version: 2023-06-01, anthropic-beta: files-api-2025-04-14
//   2xx / 404 → 了结（404 = 供应商侧已无，视为删成）
//   401 / 403 → warn 放弃（key 失效，重试无意义）
//   429 / 5xx / fetch throw → enqueueRetry(configId, fileId, status)
```

退避表（attempts → 下次间隔）：`[1h, 4h, 12h, 24h, 48h]`，第 5 次失败删条目 + warn（带 providerFileId，供人工追查）。

### 三个删除路径插桩

- `deleteFile`：行删除成功后 `await deleteProviderFileReferences(file)`（file 已是全列记录）。用户请求路径多一次供应商调用（成功时 ~200ms），可接受；失败入队不阻塞。
- `deleteFilesIfUnreferenced` / `sweepOrphanFiles`：行查询 select 补 `providerReferences` 列，删除成功后同样调用；两条路径本来就是 best-effort 循环，语义不变。
- `sweepOrphanFiles` 末尾追加 `processDeleteRetries()`：取 `nextRetryAt <= now` 的全表条目（跨用户——供应商文件无用户语义，sweep 触发时机是任何用户上传），逐条 attemptDelete；队列空 → 零 API 调用（PRD 不变量）。

### 与发送路径的竞态

删除只发生在「无消息引用」的文件上（三路径都有 isFileReferenced/孤儿判定），而 ensureProviderReference 只服务被消息引用的文件 → 不会删到发送中正在用的引用。文件删除后该引用永不再被上传，无反向竞态。

pending 行（`sizeBytes=0`）仍可被构造请求引用：`resolveOwnedFileParts` 不把 0 字节当作无效附件——空 `.txt` 是合法上传（extraction `empty` ≠ 不可发送），用一个列值区分「空文件」与「未完成的直传占位」会把合法的空文件也一并拒掉。未完成直传被引用时，`resolveAttachmentsForModel` 会因对象缺失（storage.get 抛 ENOENT/NoSuchKey）而使该回合失败；该失败发生在 `appendUserMessage` 之前（见 backend/chat-attachments.md 的 bad case），回合不落库、不 wedge topic，用户重传即可。因此接受该边界，不引入新列做 pending 标记。

## 6. 关键取舍记录

1. **presign 即插行（pending 语义）而非 complete 才插行**：未完成直传复用既有 24h orphan sweep 回收，无需 S3 侧 list-diff 新机制；代价是管理页（兄弟任务）需容忍 sizeBytes=0 的行（24h 内自动消失）。
2. **complete 用 storage.get 实际字节数定 size**：省 HeadObject，且抽取本来要拉字节；直连省的是客户端→服务器这一段，服务器→S3 回拉在容器网络内成本极低。
3. **两道大小闸**：S3 policy content-length-range（第一道）+ complete 服务端校验（第二道）；不信任任何客户端自报值。
4. **direct 开 + 无 S3 启动报错而非静默回落**：同一 env 在所有部署行为一致（memory #73 口径）。
5. **下载走 302 而非客户端直连签名 URL**：归属校验保留在请求路径上（他人 id 永远不会换到签名 URL），客户端零改动；代价是每次预览多一次廉价的服务端签名（本地计算，无网络往返）。
6. **一个开关管双向直连**：上传（presigned POST）与下载（302 presigned GET）同属「客户端与 S3 直接传字节」语义，拆成两个 env 只会制造四种组合中两种无意义的矩阵；默认关保持二期行为。
5. **C 独立模块而非塞进 provider-files.ts**：provider-files 是发送路径优化层（"永不 throw、失败回退内联"），删除联动是生命周期管理，错误语义与触发点都不同；共享的错误分类逻辑（uploadStatus）导出复用。
6. **重试队列挂 sweep 而非定时器**：项目无后台任务基础设施（二期惰性续传同口径）；上传触发 sweep 足够频繁；队列空时零成本。
7. **retry 表不外键 provider_configs**：config 删除后条目仍在，attemptDelete 查不到 config → warn 放弃，语义闭环。
8. **env 单位用 MB 而非 bytes**：运维可读性；zod coerce 容忍字符串数字。

## 7. 测试策略

- limits/env 单测：默认值、边界（1/100/101/0/非整数）、direct 无 S3 报错。
- file.service 单测：uploadFile 动态上限；presignFile 插行 + 调 presigner；completeFile——对象缺失 404、超限删对象删行、正常更新 + 抽取调用。
- provider-delete 单测：mock fetch——google 引用跳过、claude 成功/404 了结、401/403 放弃、429/5xx 入队；退避序列与 5 次上限；config 失联放弃。
- file.service 删除路径单测：三路径调用 deleteProviderFileReferences（mock 验证）。
- 集成测试（既有 PG 测试模式）：presign→complete 全流程（mock S3 或 LocalStack？——既有 storage.test.ts 模式为准，若现有 S3 测试是 mock client 则同法）。
- 手测：rustfs compose 环境 direct 开全链路；direct 关回归。

## 8. 运维与回滚

- 回滚 = revert + drop table provider_file_delete_retries（留存无害：无代码读它时即死表）。
- env 默认（20MB、direct 关）下行为与二期完全一致；presign/complete 在 direct 关时 404。
- pending 行（sizeBytes=0）最长存活 24h，被既有 sweep 回收。
