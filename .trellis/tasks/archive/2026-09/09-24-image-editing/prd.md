# 聊天内图片编辑（图生图）

## Goal

在现有聊天内生图（09-21-image-generation）基础上支持图片编辑 / img2img：用户携带参考图发起生图请求，模型基于参考图 + 提示词产出编辑结果。生图旁路、能力表、附件体系在设计时已按此复用预留。

## Background（代码证据）

- 生图旁路：`src/app/api/chat/route.ts` `imageGenerationResponse()`（L95 起）——命中 `outputModalities` 含 `image` 的模型时走 `createImageGenerationResponse`，无工具、无历史、无附件路由；当前首行即拒绝任何 file part（400 `image.attachmentUnsupported`）。
- regenerate 旁路：`src/app/api/topics/[id]/messages/[messageId]/regenerate/route.ts` L107 起，同样走 image 旁路，目前不做附件路由；prompt 取目标历史最后一条 user 消息文本。
- 生成适配层：`src/server/ai/image/generate.ts` —— `FORMAT_ADAPTERS` 按 `ProviderApiFormat` 分发（openai-compatible → `POST /images/generations`；google → `generateContent`；claude → null 前置拒绝）。响应解析、b64 魔数嗅探（约束 #232）、`thought` 过滤（#231）、120s 超时（#205）已就绪。
- 持久化：`src/server/ai/image/turn.ts` —— 生成图经 `uploadFile`（`skipSizeLimit`，约束 #229）落为普通附件；部分失败/中止做 best-effort 清理（#230）；assistant 消息 file part 不回灌后续对话（#208）。
- 能力表：`src/lib/image-capabilities.ts` —— 静态家族表（provider API 不返回参数能力，约束 #201），`imageCapabilityFor(modelId)` + `isSizeAllowed` 由 composer 与 server 共用。当前表只描述输出参数（sizeMode / sizes / nMax / qualities / imageSizes / freeform），无图像输入能力字段。
- 前端：`Composer.tsx` imageMode 下隐藏附件按钮（L241 `!imageMode`）、搜索与 reasoning；`ChatView.tsx` L577/L746 判定 image 模式；附件选择即上传（`use-composer-attachments.ts`），每消息上限 `MAX_ATTACHMENTS_PER_MESSAGE = 5`（`src/lib/files/constants.ts`）；`StagedAttachment.file` 当前必填。
- 服务端附件归属校验：`resolveOwnedFileParts`（`src/server/files/file.service.ts` L565）按 url 重读文件行、校验归属、规范化 part；字节读取经 `getFilesByIds` + `getFileStorage()`（attachments.ts L266/L310 已有先例）。
- 图片预览对话框：`src/components/common/ImagePreviewDialog.tsx`（MessageItem 与 FilesScreen 共用）——"编辑这张图"入口挂载点。
- 厂商参数约束记忆：#214–#222（gpt-image 系 freeform/quality、Gemini imageSize 层级、Seedream 像素下限/单图、qwen-image 固定档/2.0+ freeform、wan 像素窗口）、#220（网关不映射 Gemini 编辑路径，需 `apiFormat: google`）。

## 编辑端点调研（2026-09-24）

- **OpenAI `POST /images/edits`**：multipart/form-data；`image` 最多 16 张（png/webp/jpg，单张 <50MB）；可选 `mask`、`input_fidelity`、`quality`、`size`、`n`。dall-e-3 不支持编辑；dall-e-2 编辑需 mask+正方形。NewAPI 网关确认转发 `/v1/images/edits`。
- **Gemini**：同一 `generateContent` 端点，contents.parts 追加 `inlineData`（base64）即可——现有 googleAdapter 的小增量。
- **Seedream 4.5**：同一 `/images/generations`，JSON 加 `image` 数组（URL/base64），支持多图融合——与 OpenAI 家族的 edits 端点冲突，需能力表按家族分流。
- **qwen-image-edit**：DashScope 原生 `multimodal-generation/generation` 端点（非 OpenAI 兼容形状）；编辑专用独立模型 id，必须带参考图（1–3 张），仅输出 1 张。

## Key Decisions

- **参考图入口 = 手动上传 + "编辑这张图"快捷入口**：composer imageMode 放开附件（仅 `image/*`）；"编辑这张图"为双入口——缩略图右上角悬浮按钮（hover 浮现/触屏常驻，主入口）+ 预览对话框按钮（保底）——把已生成图作为 referenced attachment 载入 composer（不重新上传）。明确不做自动携带上一张生成图——隐式状态易误触发且产生意外费用。
- **"编辑这张图"不做模型门控**：选中视觉文本模型时该图走普通附件流程（自然正确）；选中文生图-only 模型时 server 400 兜底。
- **一期厂商范围 = Gemini 图像输入 + Seedream `image` 参数 + OpenAI `images/edits`**。能力表加 `imageInput?: { max, openAiTransport }`（缺省 = 不支持图像输入）。qwen-image-edit（新 transport + 参考图必填语义）与 dall-e 系编辑本期不做。
- **参考图数量上限 = `min(MAX_ATTACHMENTS_PER_MESSAGE=5, imageInput.max)`**，不引入新常量。
- **提示词保持必填**：三家端点 prompt 均必填，imageMode 下附件-only 发送在前端禁用。
- **mask / input_fidelity / background 参数不暴露**（无诉求，YAGNI）。
- 能力表各家族 `imageInput.max` 初值取自文档调研，check 阶段实证校准，上游 400 透传为兜底。

## Requirements

- R1 能力表：`ImageModelCapability` 加 `imageInput?: { max: number; openAiTransport: "edits" | "generations-param" }`；家族初值按 design §2 表；缺省/未知模型 = 不支持。
- R2 /api/chat image 分支：参考图经 `resolveOwnedFileParts` 归属校验 + `getFilesByIds` + storage 读字节；分级校验——模型不接受图像输入 → 400 `image.attachmentUnsupported`；超 `imageInput.max` → 400 `image.tooManyReferences`；非 image/* → 400 `image.referenceNotImage`；全部先于 topic 创建。
- R3 适配器：google 前置 inlineData parts；openai-compatible 按 `openAiTransport` 分流（edits multipart / generations `image` base64 data URL）；无参考图时请求与现状逐字节一致。
- R4 regenerate 旁路：从源 user 消息 file parts 复解参考图，走同一流程。
- R5 Composer：imageMode 且 `imageInputMax > 0` 时显示附件按钮/列表，`accept="image/*"`，仅接受图像类型，上限 `min(5, imageInputMax)`，draft 必填。
- R6 "编辑这张图"双入口：a) 每张图片缩略图右上角悬浮编辑按钮（hover 设备悬停浮现、触屏常驻，绑定该 part 文件 id，多图消息无歧义；`MessageActions` 不动）；b) ImagePreviewDialog 加 `onEdit?` 按钮（永远可见，保底路径；FilesScreen 不开放）。两入口同一处理函数：接线为 referenced attachment（`StagedAttachment.file` 放宽为可选，`retryAttachment` 对无 file no-op）。
- R7 i18n：新增 key（`image.tooManyReferences`、`image.referenceNotImage`、"编辑这张图"按钮）en/zh-CN 同步，无硬编码 JSX 字符串。
- R8 参考图持久化为 user 消息普通 file part（消息列表可见，配额/级联删除/孤儿扫描零新增）。

## Acceptance Criteria

> [x] 已完成并验证；[~] 单测已过，实证待渠道（gpt-image edits 已于 2026-09-24 实证；Gemini/Seedream 无渠道，按决策保持 imageInput 开启、上游 400 透传兜底）


- [~] AC1 选中 gemini 图像模型 + 参考图 + 提示词 → 生成编辑结果，assistant 消息含生成图 file part，user 消息含参考图 file part（实证，google 格式直连）。
- [x] AC2 选中 gpt-image 系模型 + 参考图 → 走 `/images/edits` multipart，成功产出（实证，NewAPI 网关或直连）。
- [~] AC3 选中 seedream-4.5 + 参考图 → `/images/generations` 带 `image` data URL，成功产出（实证）。
- [x] AC4 无参考图的纯文生图请求与现状行为逐字节一致（单测 body 断言）。
- [x] AC5 对 imageInput 缺省的模型（qwen-image / wan / dall-e / 未知模型）带附件 → 400 `image.attachmentUnsupported`，且不创建 topic/message 行（单测）。
- [x] AC6 参考图超上限 / 非图像附件 → 400 `image.tooManyReferences` / `image.referenceNotImage`（单测）。
- [~] AC7 regenerate 一条带参考图的编辑消息 → 新版本加入原 version group，参考图从源消息复解（单测 + 实证）。
- [~] AC8 缩略图悬浮按钮或预览对话框按钮点击后，该图以 ready 态出现在 composer，不触发新上传；发送后消息引用同一文件 id（单测 + 浏览器实证）。
- [x] AC9 Composer imageMode 下：附件按钮仅对 imageInputMax>0 模型可见；非图像文件被前端拒绝；超过上限被拒绝；draft 为空时禁用发送（单测）。
- [x] AC10 `pnpm test` 全绿、`pnpm lint` 通过、`pnpm build` 通过。

## Out of Scope

- qwen-image-edit / wan 编辑模型（DashScope 原生 transport，二期）
- dall-e 系编辑（mask+正方形）
- mask / inpainting 涂抹 UI、`input_fidelity`、`background` 参数暴露
- 自动携带上一张生成图（隐式参考图）
- 生图参数持久化到 assistant 消息 metadata 供一键复用（用户明确本期不做）
- 独立生图页面 / 画廊 / 批量工作台；生图 tool calling
- 非图像类附件（PDF 等）进入生图旁路

## Deferred / Risks

- 能力表 `imageInput.max` 初值与 Seedream data URL 接受性、网关 multipart 字段形状为实证校准点（design §7），check 阶段用 zzx 的可用渠道验证；校准失败的最差退路是把对应家族 `imageInput` 置空（回退最小）。
