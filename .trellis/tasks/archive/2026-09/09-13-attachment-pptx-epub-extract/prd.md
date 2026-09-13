# pptx/epub 文档解析接入附件抽取管道

## Goal

附件上传白名单新增 pptx 与 epub，两者在上传时经既有抽取管道解析为结构化文本（pptx 按页 + speaker notes，epub 按章节），复用清洗、截断、缓存与降级注入机制，对所有文本模型可用。

## Background / Confirmed Facts

- 一期管道：`POST /api/files` 上传时同步抽取（memory #49）→ `extractDocument` 调度器（src/server/files/extract/index.ts）按 `classifyFile` 类别分发 → 结果（status/text/truncated/error）缓存进 files 表 → 发送时 `planExtracted` 注入 `<attachment>` 包裹的 text part。
- pptx 与 xlsx 同为 ZIP 容器，office.ts 已有 `PK\x03\x04` 签名校验先例。
- lobe-chat 的 pptx loader 验证了纯 JS 方案：解 zip → `ppt/slides/slideN.xml` 按页码排序 → `<a:p>` 段落取 `<a:t>` 文本。lobe 未抽 speaker notes，本任务补上（`ppt/notesSlides/notesSlideN.xml`）。
- epub 为 ZIP + XHTML：`META-INF/container.xml` 定位 OPF → spine 定义阅读顺序 → 每章 XHTML。项目已有 `node-html-markdown` 依赖（docx 在用），可直接转 Markdown。
- open-webui 对 pptx/epub 均委托 unstructured，无轻量实现可借鉴。

## Requirements

### R1 pptx 解析

- 白名单放行 `application/vnd.openxmlformats-officedocument.presentationml.presentation`（及 `.pptx` 扩展名兜底），归类为 `office` 或新类别。
- ZIP 签名校验，非 ZIP 容器（含旧版二进制 .ppt）明确失败。
- 按页抽取：每页输出 `## Slide N` 段落，含正文文本与 speaker notes（有则附 `Notes:` 小节）。
- 空 pptx（无任何文本）→ `empty` 状态，发送时报 `file.noTextLayer` 语义错误（走既有管道）。

### R2 epub 解析

- 白名单放行 `application/epub+zip`（及 `.epub` 扩展名兜底）。
- 按 spine 阅读顺序遍历章节，XHTML 经 `node-html-markdown` 转 Markdown 拼接。
- 损坏/非标准 epub（缺 container.xml 或 OPF）→ `failed` 状态 + 明确错误。

### R3 管道复用与一致性

- 两者输出统一经 `sanitizeExtractedText` 清洗（memory #58）与 `truncateText` 截断，截断标记沿用既有 `truncated` 语义。
- 抽取状态/错误在 composer chip 与发送路径的呈现与 docx/xlsx 一致（memory #49 的既有机制，无新增 UI 类型）。
- `SUPPORTED_FILE_ACCEPT` 与白名单同步更新，二者不漂移（既有契约）。

## Acceptance Criteria

- [ ] 上传含多页（含 speaker notes）的 pptx，模型收到按页组织的 Markdown 且 notes 内容可见。
- [ ] 上传 epub，模型收到按 spine 顺序拼接的章节 Markdown。
- [ ] 上传旧版 .ppt / 损坏 .pptx / 损坏 .epub：上传或发送时得到明确错误提示，不产生空上下文回答。
- [ ] 无文本 pptx → 发送时报「无文本」类错误（与扫描件 PDF 语义一致）。
- [ ] 超长 pptx/epub 被截断时 UI 有可见提示，模型回答基于已注入部分。
- [ ] 抽取产物经清洗后不含 Postgres 拒绝的控制字符（memory #58 回归）。
- [ ] 文件选择器 accept 与新格式一致；移动端选择可用（memory #15）。

## Out of Scope

- 旧版二进制 .ppt 解析（OLE 容器，成本不成比例）。
- pptx 中的图片/图表内容理解（转图片发视觉模型等）。
- epub 内嵌图片、目录导航 UI。
