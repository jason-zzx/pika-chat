# 聊天附件二期：S3 存储、供应商 Files API 与 pptx/epub 解析（父任务）

## Goal

在一期附件能力（上传、能力路由、抽取缓存）之上做三件独立可验证的演进：

1. **pptx/epub 解析**：附件抽取管道新增 pptx（含 speaker notes）与 epub 格式。
2. **S3 兼容对象存储**：在既有 `FileStorage` 接口后提供 S3 实现，支撑多副本部署。
3. **供应商 Files API 传输优化 + 音视频原生直通**：google/claude 格式经 AI SDK `uploadFile` 上传附件并以 `ProviderReference` 引用发送；音视频附件对声明支持且可序列化的模型原生直通。

## Background / Confirmed Facts

调研结论（2026-09-13 会话）：

- 一期已交付：`FileStorage` 接口 + 本地磁盘实现（src/server/files/storage.ts）；上传时抽取 + files 表缓存（memory #49）；`resolveAttachmentsForModel` 按 `inputModalities` 路由（src/server/ai/attachments.ts）；控制字符清洗在调度器（memory #58）。
- 一期 PRD Out of Scope 池即二期候选：`S3 / Files API / OCR / RAG / 更多格式 / 管理页`。
- **AI SDK 7 原生支持 Files API**：`ai@7.0.85` 导出 `uploadFile()` 返回 `ProviderReference`（`Record<string,string>`），FileUIPart 的 `providerReference` 字段在模型消息中优先于 url。`@ai-sdk/google@4.0.67` 与 `@ai-sdk/anthropic@4.0.52` 均实现 `.files()`；`@ai-sdk/openai-compatible@3.0.41` **没有** `.files()` 且不序列化 providerReference。
- openai-compatible 对音频 file part 序列化为 `input_audio`（仅 wav/mp3/mpeg），视频直接抛 UnsupportedFunctionality；google 内联支持白名单内音视频。
- 业界对齐：LobeChat 仅对 Gemini 音视频用 Files API（PR #9630）；Open WebUI 不用供应商 Files API；Cherry Studio 用了但踩坑（大文件引用失败、渠道拒绝 part 类型）。共同结论：自有存储为 source of truth，Files API 只是优化层，内联回退必须永远保留。
- 解析器参考：lobe-chat `@lobechat/file-loaders` 的 pptx 实现（yauzl 解 zip + xmldom 取 `<a:p>/<a:t>`，无 notes）；open-webui 的 pptx/epub 均委托 unstructured，无轻量实现可抄。

## 用户已拍板的范围决定（2026-09-13）

- **不做**：扫描件 OCR / Docling 等外部预处理、RAG/知识库、音频转录与视频内容解析、Files API 的用户侧开关。
- 附件管理页、管理员配额配置界面：经确认**推迟到三期**（2026-09-13），二期保持存储/传输/解析的架构演进主线。
- Files API 能力判定 = 静态（apiFormat ∈ {google, claude}）+ 运行时失败负缓存（持久类错误才写，瞬时错误只当轮回退）；`openai-compatible` 明确排除，永远内联。
- Gemini Files API 48h 过期：惰性续传（请求路径上发现过期即重传），无后台任务。
- 音视频原生直通：对所有**声明对应 input 模态且当前 apiFormat 可序列化该 mediaType** 的模型放行；不支持则硬错误（无抽取回退，类比 `file.imageRequiresVision`）。不单列子任务，并入 Files API 子任务。
- 单文件 20MB / 单消息 5 个附件上限维持不变（大视频依赖 Files API 引用的放宽留待后续）。

## 子任务映射

| 子任务 | 交付物 | 依赖 | 建议顺序 |
|--------|--------|------|----------|
| 09-13-attachment-pptx-epub-extract | pptx/epub 解析接入抽取管道 | 仅依赖一期抽取管道 | 1 |
| 09-13-attachment-s3-storage | S3 兼容存储实现 + env 切换 | 仅依赖一期 FileStorage 接口 | 2 |
| 09-13-attachment-provider-files-api | Files API 引用传输 + 负缓存/续传 + 音视频直通 | 仅依赖一期路由；**不依赖** S3 子任务（磁盘实现下同样成立） | 3 |

三个子任务互相无代码依赖，可独立 implement / check / archive；上表顺序只是复杂度递增的建议，不是阻塞关系。

## Cross-Child Acceptance Criteria（父任务集成审查用）

- [ ] 三个子任务全部归档后，一期全部既有验收场景（图片/pdf/docx/xlsx/文本的上传、路由、降级、错误提示）无回归。
- [ ] 磁盘与 S3 两种存储后端下，上传→抽取→发送→下载全链路行为一致（Files API 引用路径同样以自有存储为 source of truth）。
- [ ] 不支持的渠道/模型上，用户始终得到明确错误或无缝内联降级，绝不出现"静默丢附件"或"空上下文作答"。

## Out of Scope（三期及以后）

- openai-compatible 渠道的 Files API（需绕过 SDK 序列化，投入产出比低）。
- 音视频大文件（>20MB）上限放宽 + Files API 大文件引用。
- OCR、RAG、转录、附件管理页（同一期口径）。

## Notes

- 父任务不做直接实现；实现发生在各子任务。父任务在所有子任务归档后做最终集成审查再归档。
