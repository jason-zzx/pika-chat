# 技术设计：Files API 引用传输 + 音视频原生直通

## 1. 架构与边界

```
src/server/ai/attachments.ts        路由核心（扩展，不改契约形状）
src/server/ai/provider-files.ts     新：Files API 上传/引用解析/负缓存判定
src/server/ai/provider-factory.ts   新函数 createFilesApi(endpoint) → FilesV4 | null
src/server/db/schema/file.ts        files 表 + provider_references jsonb
src/server/db/schema/provider.ts    provider_configs + files_api_unsupported_at
src/lib/files/media-types.ts        白名单 + audio/video 分类
前端                                 composer chip / 消息卡片 AV 预览
```

核心原则：**自有存储永远是字节的 source of truth**；`provider_references` 只是可再生的缓存。任何环节失败都能回退到一期内联路径。

## 2. 数据模型

```ts
// files 表新增
providerReferences: jsonb("provider_references")
  .default(sql`'{}'::jsonb`)
// 形状：Record<providerConfigId, {
//   reference: Record<string, string>,  // SDK ProviderReference，如 {google: uri}
//   uploadedAt: string,                 // ISO
//   expiresAt: string | null,           // claude 恒 null
// }>

// provider_configs 新增
filesApiUnsupportedAt: timestamptz("files_api_unsupported_at")  // 负缓存，null=可用
```

migration 一个：两列均可空/默认值，无存量数据处理。

负缓存清除：`provider.service.ts` 的更新路径在 baseUrl / encryptedApiKey / apiFormat 任一变化时把 `filesApiUnsupportedAt` 置 null。

## 3. provider-files.ts（新模块）

```ts
// 静态能力：只有 google/claude 可能支持
function filesApiEligible(apiFormat): boolean

// 主入口：确保给定 file 对给定 config 有有效引用
async function ensureProviderReference(args: {
  file: FileRecord; configId: string; endpoint: ProviderEndpoint;
}): Promise<
  | { kind: "reference"; reference: ProviderReference }
  | { kind: "fallback" }   // 调用方走内联
>
```

流程：

```
config 有 filesApiUnsupportedAt → fallback
files.providerReferences[configId] 存在且未过期（expiresAt - now > 30min）→ reference
否则：
  buffer = storage.get(file.storageKey)
  uploadFile({ api: createFilesApi(endpoint), data: buffer, mediaType, filename })
  成功 → 写 files.providerReferences（merge，不覆盖其他 config 的键）
         expiresAt：google 取响应 expirationTime，取不到 uploadedAt+48h；claude null
         → reference
  失败 → 分类：
    永久类(400/403/404/501) → 写 configs.filesApiUnsupportedAt = now → fallback
    瞬时类(429/5xx/network/timeout) → fallback（不落负缓存）
```

错误分类基于 AI SDK 包装的 HTTP 错误（`statusCode` 字段；实现时实证 SDK 错误形状，APICallError）。**此模块所有失败都返回 fallback，绝不 throw**——发送不被传输优化阻塞。

`createFilesApi(endpoint)`：`google` → `createGoogle(...)` 实例（有 `.files()`）；`claude` → `createAnthropic(...)`；其余 → null。注意 provider-factory 现有 FORMAT_PROVIDERS 返回 LanguageModel，需平行函数返回 provider 实例本身。

## 4. 路由扩展（attachments.ts）

`AttachmentCapabilities` 扩展为：

```ts
{
  inputModalities: string[];
  apiFormat: ProviderApiFormat;
  providerConfigId: string;
}
```

两个调用点（chat / regenerate）都能提供：providerConfigId 来自输入/消息元数据，apiFormat 经 `ChatModelHandle` 扩展携带（chat-model.ts 的 loadConfigRow 已查到 apiFormat，透出即可）。

`planAttachment` 的 native 分支升级为三级：

```
1. 模型模态不支持（image/pdf/audio/video 各自查）→ 既有错误或新 file.mediaUnsupported
2. apiFormat 可引用（eligible 且无负缓存）→ ensureProviderReference
   → reference：file part 带 providerReference（url 保留 /api/files/<id>，SDK 优先用 reference）
   → fallback：内联 data URL（现状）
3. apiFormat 不可引用 → 内联 data URL（现状）
```

**实现验证点**（开工第一周确认）：`replayModelMessages` → `convertToModelMessages` 是否把 UIMessage file part 的 `providerReference` 透传进模型消息（FileUIPart schema 文档说优先于 url；需在 google/claude 两家各跑一次实证）。若不透传，备选方案：路由层直接产出模型消息级 part 或经 SDK 内部形状注入，改动仍收敛在 attachments.ts。

> **已确认**（ai@7.0.85 / @ai-sdk/google@4.0.67 / @ai-sdk/anthropic@4.0.52 实证）：透传成立，路由层只需要在 UI file part 上设 `providerReference`，`url` 保留 `/api/files/<id>`。
>
> 上传失败的错误形状两家不同，负缓存分类据此实现：
>
> - claude → `APICallError`，带 `statusCode`（实测 404 / 500）；网络失败也是 `APICallError`，但 `statusCode` 为 `undefined`。
> - google → 普通 `AISDKError`（`name: GOOGLE_FILES_UPLOAD_ERROR`），**没有 `statusCode`**，HTTP 状态只在 message 里（`Failed to initiate resumable upload: 404 {…}`）；网络失败是裸 `TypeError: fetch failed`。
> - `@ai-sdk/openai-compatible` 没有 `.files()`（实测 `undefined`）。
> - `ai.uploadFile()` 的返回类型不含 `expiresAt`，但 `providerMetadata.google.expirationTime` 会透传，Gemini 过期从那里取。

音视频双判定的序列化能力表：

```ts
const AV_SERIALIZATION: Record<ProviderApiFormat, { audio: Set<string>; video: Set<string> }> = {
  google: { audio: 全部白名单, video: 全部白名单 },
  claude: { audio: ∅, video: ∅ },
  "openai-compatible": { audio: {wav, mp3, mpeg}, video: ∅ },
};
```

## 5. media-types.ts 变更

- `AUDIO_MEDIA_TYPES`（mpeg/mp3、wav、x-wav、mp4/m4a、aac、ogg、flac、webm）与 `VIDEO_MEDIA_TYPES`（mp4、webm、quicktime）常量 + 别名归一（audio/x-m4a→audio/mp4 等）。
- `FileCategory` 新增 `"audio" | "video"`；`classifyFile` 加分支；`SUPPORTED_FILE_ACCEPT` 同步。
- 音视频无抽取：上传路径 file.service 对这两类跳过 extractDocument（extractionStatus 保持 `none`）——查 file.service 现按类别调抽取的位置，加 early skip。

## 6. 前端

- composer：accept 更新自动生效；chip 增加音视频图标（lucide `FileAudio`/`FileVideo`）。
- 消息附件卡片：mediaType 前缀 audio/ → `<audio controls preload="none" src={attachment.url}>`；video/ → `<video controls preload="none">`；同域认证端点直接可用。
- 新 i18n key：`file.mediaUnsupported`（错误消息）+ 卡片 a11y 标签；走既有 i18n 管道（memory #45 注意事件处理器内字面量）。
- 移动端：`<audio>/<video controls>` 原生控件即 tap 路径，无 hover 依赖（memory #15）。

## 7. 测试策略

- provider-files.ts 单测：mock `uploadFile`（vi.mock "ai"）覆盖——成功写引用、过期重传、永久错误写负缓存、瞬时错误不写、负缓存短路。
- attachments.ts 单测：三级路由矩阵（模态×apiFormat×mediaType）、providerReference part 形状、内联回退不变量。
- media-types 分类/accept 单测。
- 手测矩阵：Gemini 官方 key 全链路（含隔天续传可用假 expiresAt 模拟）；claude 官方 key；一个不支持 Files API 的 openai-compatible 端点验证永不尝试上传。

## 8. 关键取舍记录

1. **惰性上传（发送路径）而非上传时**：避免上传从未发送的文件；且引用按 config 维度，上传时还不知道会用哪个 config 发送。
2. **负缓存写库而非内存**：多副本/重启后仍生效；config 变更自动清除给了恢复路径。
3. **引用按 providerConfigId 键控**：同 apiFormat 的不同账号/端点引用互不可用（Gemini uri 含账号语义）。
4. **过期余量 30min**：发送中途过期的竞态窗口。
5. **音视频不做抽取回退**：无转录能力（父任务拍板），硬错误语义与 imageRequiresVision 一致。
6. **20MB 上限不动**：引用传输落地后三期再评估大文件。

## 9. 运维与回滚

- 回滚 = revert；`provider_references` / `files_api_unsupported_at` 两列留存无害（内联路径不读它们时行为即一期）。
- Gemini 侧孤儿文件：过期自动清理（48h）；claude 侧文件不过期但无列表/清理 UI——记录为已知债务，三期附件管理页一并考虑。
