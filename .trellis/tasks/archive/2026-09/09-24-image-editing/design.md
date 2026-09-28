# 聊天内图片编辑 — 技术设计

> 基于 `09-21-image-generation` 的生图旁路扩展。Spec 基线：`.trellis/spec/backend/image-generation.md`（本任务完成后需更新）。

## 1. 总体形状

不改 pipeline、不加表。三处接缝各扩一处：

1. **能力表**（`src/lib/image-capabilities.ts`）：`ImageModelCapability` 加图像输入描述；
2. **后端旁路**（route + `image/generate.ts` + `image/turn.ts`）：参考图从 file part 解析为字节，随 params 传入适配器；
3. **前端**（Composer + ImagePreviewDialog/MessageItem）：imageMode 放开图像附件，加"编辑这张图"入口。

## 2. 能力表扩展

```ts
type ImageModelCapability = {
  // ...existing fields
  /** 参考图输入能力；缺省 = 不接受图像输入（纯文生图）。 */
  imageInput?: {
    max: number;
    /** openai-compatible 格式下的编辑 transport：
     *  "edits" = POST /images/edits (multipart, OpenAI 家族)
     *  "generations-param" = /images/generations JSON 加 image 数组 (Seedream)
     *  google 格式忽略此字段（永远 inlineData）。 */
    openAiTransport: "edits" | "generations-param";
  };
};
```

家族初值（文档调研值，check 阶段实证校准；上游 400 透传是兜底）：

| 家族 | imageInput |
|---|---|
| gpt-image-2.5 / 2 / 1 系 | `{ max: 16, openAiTransport: "edits" }`（官方 edits 上限 16，单张 <50MB） |
| dall-e-2 / dall-e-3 | 无字段（dall-e-3 不支持编辑；dall-e-2 编辑需 mask+正方形，明确不做） |
| gemini-3-pro-image / 3.1-flash-image | `{ max: 3, openAiTransport: "generations-param" }`（经网关走 OpenAI 形状时用 generations-param 实证；直连 google 格式走 inlineData） |
| gemini-2.5-flash-image / 3.1-flash-lite-image | 同上 `{ max: 3, ... }` |
| seedream-4.5 / 5.0-lite / 4.0 / 通用 seedream | `{ max: 4, openAiTransport: "generations-param" }`（多图融合） |
| seedream-5.0-pro | 无字段（n=1 单图模型，编辑能力未证实，保守不给） |
| qwen-image 系 / wan 系 | 无字段（编辑是独立模型 id，二期） |
| DEFAULT_IMAGE_CAPABILITY | 无字段（未知模型保守纯文生图） |

`imageInputMax` 语义由 `capability.imageInput?.max ?? 0` 表达，composer 与服务端共用同一表（与 sizes 一致的单源原则）。

## 3. 后端数据流

### 3.1 参考图解析（/api/chat image 分支）

替换 `image.attachmentUnsupported` 一刀切为：

```
fileParts = resolveOwnedFileParts(parts.filter(file), actor)   // 归属校验+规范化，复用文本路径
if (fileParts.length > 0):
  cap = capability.imageInput
  if (!cap)                        → 400 image.attachmentUnsupported   // 现有 key，语义不变
  if (fileParts.length > cap.max)  → 400 image.tooManyReferences {max}  // 新 key
  if (任一 mediaType 非 image/*)    → 400 image.referenceNotImage       // 新 key
```

参考图字节获取：`resolveOwnedFileParts` 得 canonical parts → `getFilesByIds` → `getFileStorage()` 读字节 → `GeneratedImage[]`（`{bytes, mediaType}`，与输出同型，直接复用）。**仍先校验、后建 topic row**，拒绝的 turn 不留痕迹。

参考图走普通上传管线（`maxFileBytes` 20MiB 上限适用——参考图是用户上传，不享受 `skipSizeLimit`）。

### 3.2 适配器改动（image/generate.ts）

`ImageGenParams` 加 `references?: GeneratedImage[]`。

- **google**：`contents[0].parts` 在 text 之前追加 `{ inlineData: { mimeType, data: b64 } }`。其余不变。n 扇出逻辑不变（每次调用都带参考图）。
- **openai-compatible**：按 `capability.imageInput.openAiTransport` 分流（仅在 `references.length > 0` 时）：
  - `"edits"`：`POST {baseUrl}/images/edits`，`multipart/form-data`（`model`、`image[]`（Blob，带 filename+type）、`prompt`、`n`、`size`、`quality`）。不传 `mask`/`input_fidelity`/`background`（本期不暴露）。响应 schema 复用现有 `{data:[{b64_json,url}]}`。NewAPI 已确认转发该端点。
  - `"generations-param"`：留在 `/images/generations`，body 加 `image: string[]`——**base64 data URL**（`data:<mediaType>;base64,...`），不能用 `/api/files/<id>`：那是需鉴权的内网 URL，provider 拉不到。实证点：Seedream 是否接受 data URL（ark 文档称支持 base64）。
  - 无 `references` 时行为与现状逐字节一致。

### 3.3 turn.ts

`createImageGenerationResponse` 签名加 `references?: GeneratedImage[]`，透传给 `generateImageForEndpoint`。持久化/清理/流协议不变。user 消息的 file part 照常持久化（参考图是消息内容的一部分，消息列表里可见）。

### 3.4 regenerate 分支

image 旁路现在取 `promptMessage` 的 file parts → `resolveOwnedFileParts` → 同一 reference 流程。参考图已被删除时 `resolveOwnedFileParts` 抛错即正确行为。

### 3.5 约束 #208 不受影响

assistant 消息的生成图仍不进后续 payload——旁路无历史，文本管线的 drop 逻辑不动。参考图只来自**当前 user 消息**的 file parts。

## 4. 前端

### 4.1 Composer 放开图像附件

- imageMode 且 `imageInputMax > 0` 时显示附件按钮与附件列表（`!imageMode` 条件改为按能力判定）；`imageInputMax === 0` 的 imageMode 模型维持现状（隐藏）。
- imageMode 下 file input `accept="image/*"`；`use-composer-attachments` 的 imageMode 变体仅接受 image/*（非图像 → 复用 `file.unsupportedType` chip 错误）。
- 粘贴与拖拽同一门槛（`attachmentsEnabled` / `sendsAttachments`）：imageInputMax>0 的 imageMode 模型同样接受贴图/拖图，image-only 过滤在 `addFiles` 兜底。
- 数量上限 `min(MAX_ATTACHMENTS_PER_MESSAGE /* =5 */, imageInputMax)`——复用既有每消息 5 张上限，不为编辑引入新常量。
- 提示词仍为必填：imageMode 下 send 需 draft 非空（三家端点 prompt 均必填；附件-only 发送在前端禁用）。
- 超上限/不支持的本地判定与 server 400 共用同一能力表。

### 4.2 "编辑这张图"入口

两个入口，同一处理函数（把该图作为 referenced attachment 塞入当前 draftKey 的 composer store，见下）：

- **缩略图右上角悬浮按钮**（主入口）：`AttachmentCard` 图片分支在每张缩略图右上角叠一个编辑按钮，渲染时绑定该 part 的文件 id——点哪张编辑哪张，单图/多图消息都无歧义。有指针设备 hover 缩略图时浮现；触屏（`@media (hover: none)`）常驻显示——项目规范禁止 hover-only 功能入口。`MessageActions`（消息级操作区）不动。
- **预览大图对话框按钮**（保底入口）：`ImagePreviewDialog` 加可选 `onEdit?: () => void`（有则渲染编辑按钮，与 download/copy 同级，永远可见）；`FilesScreen` 不传——只对聊天消息开放。

- `MessageItem` 的接线：stage 该图（`status: "ready"`、`url`/`filename`/`mediaType`/`sizeBytes` 取自 part），关闭对话框（若从对话框触发）、聚焦 composer。
- `StagedAttachment.file` 放宽为 `file?: File`（referenced 无本地 File）。`retryAttachment` 对无 `file` 的条目 no-op（referenced 永远不会进 uploading/error 态）；`removeAttachment` 行为不变——其 `deleteChatFile` 对已引用文件由 server 409 兜底（现有注释已覆盖）。
- **不做模型门控**：按钮始终可用。选中模型是视觉文本模型时，该图就是普通附件（自然正确）；选中 imageInputMax=0 的生图模型时，server 400 兜底、chip 展示错误。

### 4.3 i18n

新 key（en + zh-CN 同步）：`image.tooManyReferences`、`image.referenceNotImage`、Composer/预览对话框的"编辑这张图"按钮文案。遵守 frontend/i18n.md（无硬编码 JSX 字符串）。

## 5. 明确不做（防膨胀）

- mask / inpainting 涂抹 UI、`input_fidelity`、`background` 参数暴露（OpenAI edits 支持但本期无诉求）
- qwen-image-edit / wan 编辑模型（DashScope 原生 transport + 参考图必填语义，二期）
- dall-e 系编辑（正方形+mask，老旧）
- 跨消息自动携带参考图（方案 C，已否决）
- 参考图超出 5 张的专属上限常量（复用 MAX_ATTACHMENTS_PER_MESSAGE）
- 生图参数持久化复用（用户明确不做）

## 6. 兼容与回滚

- 请求 schema 不变（file parts 本就在 schema 内）；`imageInput` 缺省 = 不支持，旧行为对未配置家族逐字节保持。
- 纯文生图（无参考图）路径逐字节不变。
- 回滚 = revert；无迁移、无持久化格式变化。

## 7. 实证校准点（check 阶段必修）

1. gpt-image（经 NewAPI 或直连）`/images/edits` multipart 全参数形状与响应解析；
2. Seedream `image` 数组的 base64 data URL 接受性；
3. Gemini 直连 inlineData 编辑 + 经网关（apiFormat 非 google 时 generations-param 路径是否被网关接受）；
4. 能力表各家族 `imageInput.max` 初值与上游 400 文案核对。
