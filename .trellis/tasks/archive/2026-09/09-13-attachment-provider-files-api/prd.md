# 供应商 Files API 传输优化与音视频原生直通

## Goal

两件事，同一个路由层交付：

1. **Files API 引用传输**：`google` / `claude` 格式的 provider config 在发送附件时，经 AI SDK `uploadFile` 把文件一次性上传到供应商，后续轮次以 `ProviderReference` 引用代替字节内联，消除附件字节随轮次线性重传的带宽/延迟开销。
2. **音视频原生直通**：附件白名单放行音频/视频，对声明对应 input 模态且当前 apiFormat 可序列化该 mediaType 的模型原生传输；不支持则明确硬错误。

## Background / Confirmed Facts

- 一期路由：`resolveAttachmentsForModel(messages, { inputModalities })`（src/server/ai/attachments.ts），两个调用点——`POST /api/chat` 与 regenerate 路由；附件处理失败先于 `appendUserMessage`（memory #54）。
- SDK 事实（node_modules 实证，2026-09-13）：
  - `ai@7.0.85` 导出 `uploadFile()` → `ProviderReference`（`Record<string,string>`）；FileUIPart 的 `providerReference` 字段在模型消息中优先于 url。
  - `@ai-sdk/google` `.files()` 返回 `{ google: file.uri }`；上传**自动轮询 PROCESSING→ACTIVE**，FAILED 抛错；响应 schema 含 `expirationTime`。
  - `@ai-sdk/anthropic` `.files()` 返回 `{ anthropic: file_id }`。
  - `@ai-sdk/openai-compatible` **无** `.files()`，chat 序列化不认 providerReference；音频 file part → `input_audio`（仅 wav/mp3/mpeg），视频 part 直接抛 UnsupportedFunctionality。
- 供应商语义：Gemini Files API 文件 48h 自动过期；Anthropic Files API（beta）文件不过期。引用按 provider config（账号×端点）维度隔离。
- 模型模态声明来自 models.dev 目录（`provider_models.input_modalities`），Gemini 类模型含 audio/video。
- 业界：LobeChat 仅 Gemini 音视频用 Files API；Cherry Studio 踩坑证明内联回退必须永远保留。

## Requirements

### R1 Files API 引用传输（google / claude）

- 能力判定：apiFormat ∈ {google, claude} 且该 provider config 未被负缓存标记 → 路由时尝试引用路径。
- files 表新增 `provider_references`（jsonb）：`{ [providerConfigId]: { reference, uploadedAt, expiresAt | null } }`。
- 上传时机惰性：发送路径上需要原生传输且无有效引用时才 uploadFile；用户拖进 composer 不上传供应商侧。
- Gemini 过期惰性续传：`expiresAt` 过期（或剩余 < 30min 安全余量）→ 视为无引用，重传并更新记录。expiresAt 优先取 SDK 暴露的 expirationTime，取不到按 uploadedAt + 48h 计算。
- 失败分类：
  - 永久类（HTTP 400/403/404/501，端点无 Files API 或拒绝该文件类型）→ 在 provider config 上持久化负缓存标记，此后该 config 直接走内联；本轮降级内联。
  - 瞬时类（429/5xx/网络/超时）→ 仅本轮降级内联，不写负缓存。
  - 任何上传失败都**不阻塞发送**（降级内联），与 memory #54 的"附件失败中止发送"不冲突——那是路由失败（无能力模型），这是传输优化失败。
- 负缓存标记在 provider config 的 baseUrl/apiKey/apiFormat 变更时自动清除。
- 内联回退路径（现状行为）完整保留；`openai-compatible` 永远走内联。
- prompt caching 叠加只做验证记录，不单独开发（SDK/供应商侧行为）。

### R2 音视频原生直通

- 白名单新增音频（mp3/mpeg、wav、m4a、aac、ogg、flac、webm-audio）与视频（mp4、webm、quicktime）mediaType + 扩展名兜底；`SUPPORTED_FILE_ACCEPT` 同步。
- 新分类 `audio` / `video`（区分模态判定所需）；不做任何服务端抽取，extractionStatus 保持 `none`。
- 路由双判定：
  1. 模型 `inputModalities` 含 `audio` / `video`；
  2. 当前 apiFormat 序列化支持该 mediaType（静态表：google 全放行；openai-compatible 音频仅 wav/mp3/mpeg、视频无；claude 无）。
  - 两者都过 → 原生传输（google/claude 优先 Files API 引用，否则内联 data URL）。
  - 任一不过 → 硬错误 `file.mediaUnsupported`（新 i18n key），发送前中止，语义同 `file.imageRequiresVision`。
- 20MB 单文件上限维持不变（大视频依赖引用传输的放宽留三期）。

### R3 前端

- composer chip 与消息附件卡片支持音视频（图标 + 文件名 + 大小）；消息内用原生 `<audio controls>` / `<video controls>` 预览（src 走既有认证下载端点）。
- 上传白名单错误提示覆盖新类型；移动端 tap 路径不回归（memory #15）。

## Acceptance Criteria

- [ ] google 格式 + 图片/PDF 附件：首轮上传供应商侧并记录引用；第 2..N 轮请求体不含附件字节（引用发送）。
- [ ] claude 格式同上（引用为 anthropic file_id，无过期逻辑）。
- [ ] google 引用过期后续聊：自动重传一次，用户无感知。
- [ ] 模拟端点返回 404：当轮内联降级、负缓存落库、后续轮次不再尝试上传；修改该 config 的 baseUrl 后负缓存清除。
- [ ] 模拟上传超时：当轮内联降级，不写负缓存，下轮重试。
- [ ] openai-compatible 格式：任何附件永远内联，无上传尝试。
- [ ] Gemini 模型 + mp3/mp4 附件：原生发送，回答体现音视频内容；同一 topic 换纯文本模型 → 发送前明确报错。
- [ ] openai-compatible 渠道 + 声明 audio 的模型 + wav/mp3：以 input_audio 发送；m4a/ogg → 明确报错（不触达 SDK 异常）。
- [ ] 任何模型 + 视频文件 + apiFormat 不支持视频序列化 → 明确报错，不出现 SDK UnsupportedFunctionality 裸错。
- [ ] 负缓存/引用记录持久化跨重启生效。
- [ ] 一期全部既有场景无回归（含 memory #54 的失败语义、#48 的换模型重路由）。

## Out of Scope

- openai-compatible 渠道的 Files API 引用传输。
- 单文件 >20MB 上限放宽与 Gemini 大文件引用。
- prompt caching 的显式配置（如 Anthropic cache_control 标注）。
- 音视频转录/内容解析（父任务口径）。
