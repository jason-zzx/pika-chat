# 技术设计：聊天附件上传与解析（一期）

## 1. 架构与边界

新增一个附件边界上下文，聊天链路只做「接入」，不吞实现细节：

```
src/server/files/            # 附件领域（新）
  storage.ts                 # FileStorage 接口 + 本地磁盘实现 + 单例 getter
  extract/
    index.ts                 # extractDocument(buffer, mediaType) 分发器
    pdf.ts                   # unpdf：逐页抽取、按页截断、空文本层检测
    office.ts                # mammoth (docx) / sheetjs (xlsx → csv)
    text.ts                  # txt/md/csv/代码直读（UTF-8）
  file.service.ts            # 上传校验、落库、归属校验、引用检查、清理

src/server/ai/attachments.ts # 能力路由：按模型 inputModalities 转换载荷

src/app/api/files/route.ts           # POST 上传
src/app/api/files/[id]/route.ts      # GET 下载/预览、DELETE 移除暂存附件
```

聊天链路改动点（既有文件的接入位置）：

| 位置 | 改动 |
|---|---|
| `src/lib/schemas/chat.ts:48-66` | parts union 增加 `chatFilePartSchema` |
| `src/app/api/chat/route.ts:144-155` | 校验附件归属 → 落库用户消息 → `resolveAttachmentsForModel` → `replayModelMessages` |
| `src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts:125` | 回放前同样过 `resolveAttachmentsForModel` |
| `src/server/services/message.service.ts:188-211` | `appendUserMessage` 的 text-only filter（:197）放开为 text + file |
| `src/server/services/message.service.ts` / `topic.service.ts` | 删除消息/话题时级联清理文件 |
| `src/server/db/schema/` | 新增 `file.ts`；drizzle-kit 生成迁移 |

## 2. 数据模型（`files` 表）

```ts
export const fileExtractionStatus = pgEnum("file_extraction_status", [
  "none",   // 未抽取（图片等无需抽取的类型）
  "ok",
  "empty",  // 抽取成功但无文本（扫描件 PDF）
  "failed", // 损坏/加密等
]);

export const files = pgTable("files", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  extractedText: text("extracted_text"),
  extractionStatus: fileExtractionStatus("extraction_status").notNull().default("none"),
  extractionTruncated: boolean("extraction_truncated").notNull().default(false),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (table) => [index("files_user_idx").on(table.userId)]);
```

抽取结果在上传时**即时解析**并落库（见 §7 取舍），发送路径只读缓存。

## 3. 存储抽象

```ts
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
```

- 一期唯一实现 `LocalDiskFileStorage`，根目录取 `FILE_STORAGE_DIR`（env，默认 `.data/files`），key 为 `<userId>/<fileId>`，写入前 `mkdir -p`。
- 20MB 上限下用 `Buffer` 全量读写可接受；S3 实现（二期）实现同一接口即可替换，业务代码不感知。
- `src/server/env.ts` 增加 `FILE_STORAGE_DIR: z.string().optional()`。
- `.data/` 加入 `.gitignore`；部署文档注明挂卷。

## 4. 上传 / 下载 API

### POST /api/files

- `requireActor` 认证；`await request.formData()` 取 `file` 字段（自托管 Next.js 路由无默认 body 上限，自行校验）。
- 校验链：mediaType 在白名单（§5 分类表）→ `sizeBytes ≤ 20MB` → 存入 storage → insert 行 → **即时抽取**（非图片类型）→ 更新抽取列。
- 响应：`{ id, url: "/api/files/<id>", filename, mediaType, sizeBytes, extraction: { status, truncated } }`。前端凭 `extraction` 在 chip 上即时展示「无文本层」「将被截断」警告。
- 附带**孤儿清扫**（best-effort）：删除该用户 24h 前创建且未被任何消息引用的文件（引用判断用 jsonb 包含查询 `parts @> '[{"url":"/api/files/<id>"}]'`）。失败仅记日志。
- 错误：超限/不支持类型 → `AppError("VALIDATION_FAILED", 400, ...)`，i18n key 见 §9。

### GET /api/files/[id]

- 认证 + 归属校验；非本人一律 404（避免 ID 枚举）。
- `Content-Type` 用行内 mediaType；图片与 PDF 给 `Content-Disposition: inline`，其余 `attachment`；`Cache-Control: private, max-age=3600`。

### DELETE /api/files/[id]

- 认证 + 归属；仅当未被任何消息引用时允许删除（Composer 移除 chip 时调用），已引用返回 409。

## 5. 能力路由（核心模块 `src/server/ai/attachments.ts`）

```ts
export async function resolveAttachmentsForModel(
  messages: ChatUIMessage[],
  caps: { inputModalities: string[] },
): Promise<ChatUIMessage[]>
```

**纯转换**：返回新数组，持久化 parts 不动。对每条消息的每个 file part 按下表分流：

| 附件类别 | 判定 | 模型支持 | 模型不支持 |
|---|---|---|---|
| image（png/jpeg/gif/webp） | mediaType `image/*` | 原生：读字节转 data URL，file part 原样保留 | 抛 `AppError(400, "file.imageRequiresVision")` |
| pdf | `application/pdf` | 原生（`inputModalities` 含 `pdf`） | 读缓存抽取文本 → text part |
| office（docx/xlsx） | 两个具体 mediaType | — | 一律读缓存抽取文本 → text part |
| text（txt/md/csv/代码） | 白名单扩展名/媒体类型 | — | 一律读缓存抽取文本 → text part |

- **原生路径**：从 storage 读字节 → `data:<mediaType>;base64,...`。不直接把 `/api/files/<id>` 交给 AI SDK 下载——供应商够不到我们的内网地址，且自请求还要过认证，不如服务端直接内联。
- **降级路径**：text part 包裹为

  ```
  <attachment filename="report.pdf" truncated="false">
  ...extracted text...
  </attachment>
  ```

- `extractionStatus === "empty"`（扫描件）且模型不能原生消费 → 抛 `AppError(400, "file.noTextLayer")`；`failed` → `file.unreadable`。
- 两个调用点：`/api/chat`（发送）与 regenerate 路由，均在 `listTopicMessages` 之后、`replayModelMessages` 之前。regenerate 天然走最新模型能力重路由。
- **信任目录**：`inputModalities` 来自 models.dev + 手动覆盖；若目录误标导致供应商 400，走既有 `provider-error.ts` 透传，一期不做「400 后自动降级重试」。

## 6. 请求 / 持久化 schema 变更

```ts
export const chatFilePartSchema = z.object({
  type: z.literal("file"),
  url: z.string().regex(/^\/api\/files\/[\w-]+$/),
  mediaType: z.string().min(1),
  filename: z.string().min(1).optional(),
});
```

- `chatRequestMessageSchema.parts` 与 `chatStoredPartSchema` 的 union 各加上它。
- `/api/chat` 服务端**不信任客户端 url 之外的任何声明**：逐个 file part 查 `files` 表，校验归属、数量 ≤ 5、mediaType 与行内一致；通过后将 url 重写为规范形式。
- `requestToUserMessage`（route.ts:56-66）扩展为透传 file part；`appendUserMessage` 的 text-only filter 放开。
- 用户消息 parts 顺序：file parts 在前、text 在后（模型对「先看附件再读问题」表现更稳）。

## 7. 前端

### Composer

- 输入区加回形针按钮 + 隐藏 `<input type="file" multiple>`；textarea 支持**粘贴**与**拖拽**（desktop）。粘贴/拖拽在移动端不是唯一入口（memory #15），按钮永远在。
- **选择即上传**（非发送时上传）：chip 状态机 `uploading → ready | error`，error 可重试/移除；`extraction.truncated/status` 在 chip 上给警告徽标与 tooltip。
- 暂存附件存于 composer-store（按 draftKey 分桶，与草稿同生命周期），发送后清空。
- 发送：`sendMessage({ text, files: fileUIParts })`（AI SDK 原生签名，已确认 `files?: FileList | FileUIPart[]`），file part 用服务端返回的 url/mediaType/filename。
- 有附件但文本为空时允许发送（仅附件消息合法）。

### MessageItem

- 用户消息渲染 file parts：附件卡片（类别图标 + 文件名，点击打开 `/api/files/<id>` 新标签页）；图片渲染缩略图（`<img src={url}>`，点击放大走新标签页即可，一期不做灯箱）。
- 卡片不依赖 hover（memory #15），点击行为即 tap 行为。

### i18n

`src/i18n/en.json` / `zh-CN.json` 增加 `Files` 命名空间（chip 状态、警告、错误）+ `Errors` 新 key。JSX 事件处理器里的复用字符串提为模块常量（memory #45）。

## 8. 兼容性与迁移

- 迁移纯新增（`files` 表 + enum），既有表零改动；`chat_messages.parts` 为 jsonb，schema 扩展向后兼容旧行。
- 既有契约不受影响：`groupId ?? id` 键控（memory #10）、`sendStart: true`（memory #11）、`ignoreIncompleteToolCalls`（memory #23）、`x-pika-stream-id`（memory #8）。
- 删除级联：`deleteMessage` / `deleteTopic` 收集涉及消息 parts 中的 fileId，删除未被其他消息引用的 files 行与 storage 对象。

## 9. 错误分类（新 i18n key，均走 `AppError` + `withErrorHandling` 既有管道）

| 场景 | status | key |
|---|---|---|
| 超 20MB | 400 | `file.tooLarge` |
| 类型不支持 | 400 | `file.unsupportedType` |
| 附件超 5 个 | 400 | `file.tooMany` |
| 非本人/不存在 | 404 | `file.notFound` |
| 扫描件无文本层且模型不可原生消费 | 400 | `file.noTextLayer` |
| 文件损坏/加密 | 400 | `file.unreadable` |
| 图片 + 无视觉模型 | 400 | `file.imageRequiresVision` |
| 已引用文件删除 | 409 | `file.inUse` |

## 10. 关键取舍记录

1. **上传时即时抽取**（而非发送时惰性）：抽取错误在 chip 阶段即暴露，「将被截断/无文本层」警告发送前可见，发送路径只读缓存。代价是给最终走原生路径的 PDF 白做一次解析——文本层 PDF 解析为亚秒级 CPU，可接受。
2. **Buffer 全量读写**：20MB 上限下成立；S3/流式留二期。
3. **信任 `inputModalities`**：一期不做供应商 400 后的自动降级重试，避免隐式行为；目录标错由用户在模型设置里覆盖 modalities 纠正（既有能力）。
4. **本地磁盘唯一实现**：单实例自托管为部署前提；多副本场景由二期 S3 实现承接。
5. **不用 officeparser**：拿不到逐页结构与空层区分（见 PRD 调研结论）。

## 11. 运维与回滚

- 新增 env：`FILE_STORAGE_DIR`（默认 `.data/files`），无其他运维依赖。
- 回滚：功能纯增量——回退代码 + `drop table files` 迁移即可，聊天主链路无不可逆变更。
- 日志：上传/抽取/清理走既有 pino 管道，带 userId/fileId 上下文。
