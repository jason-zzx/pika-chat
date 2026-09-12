# 聊天附件上传与解析（一期）

## Goal

用户可以在聊天中随消息上传文件附件，让模型读取文件内容并据此作答。附件在多轮对话中持续可用（随历史回放），并在切换不同能力的模型时自动选择「原生文件传输」或「服务端文本抽取降级」两条路径。

## Background / Confirmed Facts

调研结论（2026-09-12 会话）：

- 消息持久化为 `chat_messages.parts`（jsonb，UI message parts），当前 `chatRequestSchema` 只接受 text part（src/lib/schemas/chat.ts:55）。
- 历史回放：`replayModelMessages`（src/server/ai/model-messages.ts）包装 `convertToModelMessages`，AI SDK v7 原生支持 `FileUIPart { type:'file', mediaType, filename, url, providerReference }`。
- 模型能力已可查：`provider_models.input_modalities`（jsonb string[]，来自 models.dev 目录，可手动覆盖）含 `text` / `image` / `pdf` 等值（src/server/db/schema/provider.ts:67，src/server/ai/model-catalog.ts:121）。
- LLM API 无状态：每轮回放全量历史，附件字节内联传输时每轮重传，带宽与 input token 开销随轮数线性增长（二期用供应商 Files API `uploadFile` + `providerReference` 优化）。
- 业界对齐（LobeChat / Cherry Studio / Open WebUI）：模型原生能力优先 + 本地分格式解析兜底 + 能力路由；RAG/知识库是独立功能，不在本期；扫描件 OCR 均为可选外部服务，默认不做。
- 解析器选型已定：自写 mediaType 分发器（LobeChat 模式），各格式用头部库——PDF 用 unpdf/pdfjs-dist（逐页结构），docx 用 mammoth，xlsx 用 SheetJS；不用聚合库 officeparser（拿不到页级结构，空文本层检测与按页截断不可行）。
- 存储：本地磁盘为默认实现 + 接口抽象预留 S3；不挂 sidecar 服务。

## Requirements

### R1 文件上传与存储

- 用户通过 Composer 选择/粘贴/拖拽上传附件，支持的类型（一期）：
  - 图片：png / jpeg / gif / webp
  - 文档：pdf、docx、xlsx
  - 文本类：txt / md / csv 及常见代码扩展名
- `POST /api/files` 上传（认证、mediaType 白名单、大小限制校验），返回 fileId。
- 限制（用户已拍板 2026-09-12）：单文件 ≤ 20MB，单消息 ≤ 5 个附件；一期不做用户级存储配额。
- 新增 `files` 表：id、user_id、filename、media_type、size_bytes、storage_key、抽取文本缓存列、created_at。
- 存储抽象接口（put/get/delete），默认实现为本地磁盘目录（env 配置路径）。
- `GET /api/files/[id]` 下载/预览，强制认证 + 归属校验（仅上传者本人）。
- 孤儿文件清理：上传后未随消息落库的附件需有回收策略。

### R2 能力路由（发送路径）

- 发送/回放前按当前模型的 `inputModalities` 对每个附件分流：
  - 模型支持该 mediaType（image/pdf）→ file part 原生传输（base64 内联）。
  - 模型不支持 PDF → 服务端抽取文本，作为带附件标记的 text part 注入（`<attachment filename=... truncated=...>`包裹）。
  - 文本类附件（txt/md/csv/code）→ 一律抽文本注入，所有模型可用。
  - docx/xlsx → 一律服务端抽文本（mammoth / SheetJS）。
  - 图片 + 无视觉能力模型 → 明确报错提示，不静默丢弃。
- 持久化的 parts 保持 file part 原样（UI 渲染附件卡片），转换只发生在发往模型的载荷上；切换模型后下一轮自动按新模型能力重路由。
- 抽取结果缓存落库（files 表列），同一文件不重复解析。

### R3 抽取质量与预算

- PDF 按页抽取（unpdf/pdfjs-dist），支持按页截断并标注 `truncated: true`。
- 抽取文本长度设预算上限（可配置常量），超限截断且用户可见提示。
- 空文本层 PDF（扫描件）→ 抽取结果为空时发送前明确报错，提示换用支持视觉/PDF 的模型。
- 加密/损坏文件 → 错误分类，用户可见的明确提示。

### R4 前端

- Composer：附件选择/粘贴/拖拽、附件 chip 列表（文件名 + 大小 + 移除）、上传中/失败状态。
- 消息气泡渲染附件卡片（文件名、类型图标、大小），图片可预览。
- `chatRequestSchema` 扩展 file part；消息列表按 `groupId ?? id` 键控的既有契约不受影响（memory #10）。
- 移动端 tap 路径可用（memory #15）。

## Acceptance Criteria

- [ ] 上传一张图片并提问，视觉模型回答体现图片内容；无视觉模型给出明确错误提示。
- [ ] 上传有文本层 PDF：支持 PDF 的模型原生接收；纯文本模型收到抽取文本并正确作答；多轮对话中附件内容持续可用。
- [ ] 上传扫描件 PDF 给纯文本模型：收到「无文本层」明确错误，不产生空上下文回答。
- [ ] 上传 docx / xlsx：模型收到结构化抽取文本（表格为 Markdown/CSV 形态）。
- [ ] 超过大小上限 / 不在白名单的文件在上传时被拒绝并提示。
- [ ] 非本人文件 ID 的下载请求返回 403/404。
- [ ] 超长文档被截断时，UI 有可见提示，模型回答仍基于已注入部分。
- [ ] 历史中的 file part 经回放后 `convertToModelMessages` 不报错，换模型后路由自动切换。

## Out of Scope（二期及以后）

- S3 兼容对象存储实现（接口预留）。
- 供应商 Files API（`uploadFile` / `providerReference`）传输优化。
- 扫描件 OCR、外部文档预处理服务、Docling 集成。
- RAG / 知识库（切块、嵌入、检索）。
- 更多格式（pptx、epub、音频/视频转录）。
- 附件管理页、管理员配额配置界面。
