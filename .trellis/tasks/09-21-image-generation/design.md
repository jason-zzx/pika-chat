# Design — 聊天内生图功能

## 总体形态

一套后端 image service（按 `apiFormat` 分发适配器）+ 聊天管线的一条非流式旁路 + composer 的生图参数 UI。不新增数据表，不改动 streamText 主管线。

## 1. 能力表（isomorphic）

新增 `src/lib/image-capabilities.ts`（client-safe，同 `provider-format.ts` 的定位）：

```ts
export type ImageSizeMode = "openai-size" | "aspect-ratio" | "freeform";
export type ImageModelCapability = {
  sizeMode: ImageSizeMode;
  // openai-size: 像素档如 "1024x1024"；aspect-ratio: 如 "1:1"；freeform: 预设档 + 允许任意 "WxH"
  sizes: string[];
  nMax: number;
  qualities?: string[];          // 如 ["low","medium","high"]，仅 OpenAI 系
  imageSizes?: string[];         // 如 ["1K","2K","4K"]，Gemini imageSize
};
export function imageCapabilityFor(modelId: string): ImageModelCapability; // 模式匹配 → 命中项，否则 DEFAULT_IMAGE_CAPABILITY
```

- 按 modelId 末段小写 substring/正则匹配，顺序即优先级。初始收录：gpt-image 系、dall-e-3、dall-e-2、gemini *image（Nano Banana 系）、seedream 系、qwen-image / wanx 系。
- `DEFAULT_IMAGE_CAPABILITY`：freeform，5 个常用宽高比预设 + nMax 1 + 自定义尺寸输入。
- 前端用它渲染参数选项；后端用它做发送前校验（非法档位 → 400，自定义 freeform 值透传）。

## 2. 后端 image service

新增 `src/server/ai/image/`：

```
image/generate.ts        generateImageForEndpoint() + per-format 适配器（Record<ProviderApiFormat, ... | null>，claude 为 null，同 provider-factory 的穷举键风格）
image/normalize.ts       参数 → 厂商 payload 的映射（size/aspectRatio/imageSize/quality/n）
```

契约：

```ts
export type GeneratedImage = { bytes: Buffer; mediaType: string }; // "image/png" | "image/jpeg" | "image/webp"
export type ImageGenParams = { prompt: string; size?: string; n: number; quality?: string; imageSize?: string };
export type ImageGenResult = { images: GeneratedImage[]; text?: string }; // Gemini 可能附带文本
export async function generateImageForEndpoint(
  endpoint: ProviderEndpoint, modelId: string, params: ImageGenParams, signal?: AbortSignal,
): Promise<ImageGenResult>;
```

- **openai-compatible**：`POST {baseUrl}/images/generations`，body `{ model, prompt, size?, n, quality?, response_format: "b64_json" }`；响应同时容忍 `b64_json` 与 `url`（url 则服务端 fetch 下载，`signal` 一并传入）。quality/非法 size 由能力表先拦，网关透传的参数原样发送。
- **google**：`POST {baseUrl}/models/{model}:generateContent`，`generationConfig.responseModalities: ["TEXT","IMAGE"]`，`imageConfig.aspectRatio` / `imageSize` 按能力表映射；解析 `candidates[].content.parts` 中 `inlineData`（图）与 `text`（文）。响应 schema 一律 `.nullish()`（provider-configs spec 的网关兼容教训）。
- **claude**：适配器为 `null`，调用方在更早处拦截（见 §3）。
- 错误映射沿用 `provider-error.ts` 约定：状态码 → `provider.*` 键，上游 body 的 message 摘要不回显敏感信息，但参数类 400 的合法值列表允许透传（R4）。
- 超时：生图耗时长，`AbortSignal.timeout(120s)` 与调用方 signal 合并（`AbortSignal.any`）。

## 3. 聊天旁路（`/api/chat` POST）

在 `requireModelForActor` 之后、topic 创建之前插入分支（保持"不可用模型不留草稿"的既有顺序）：

```
selected.outputModalities.includes("image")
  ├─ selected.apiFormat === "claude" → AppError 400 model.imageUnsupported
  └─ 是 → image 路径（见下）  否 → 现有流式路径（零改动）
```

image 路径步骤：

1. 校验附件：首发只接受纯文本 prompt（file part → 400 `image.attachmentUnsupported`，与 Won't 一致）。
2. 校验参数（请求 schema 新增可选 `image?: { size?, n?, quality? }`，zod + 能力表双重校验）。
3. `appendUserMessage`（复用，话题/草稿语义与聊天一致）。
4. `generateImageForEndpoint(endpoint, modelId, params, request.signal)`。
5. 每张图：`file.service` 写 storage + 建 files 行（owner = actor，计配额，mediaType 按实际，走 `assertUploadQuota`）。
6. `appendAssistantMessage`：parts = 图片 file parts（`url: /api/files/<id>`）+ 可选 text part；metadata 记 providerConfigId/modelId/outcome。
7. 失败：`appendAssistantMessage` outcome=failed + errorMessage（与流式失败的消息形态一致）。
8. 响应：**复用 UI message stream 协议**（`createUIMessageStream` 写入完整 assistant message 后 finish），前端消费路径零改动。这是关键决策——避免为单发响应造第二套前端协议。

regenerate 路由做同样分支（它接收 providerConfigId/modelId，重新解析能力后走 image 路径，版本组机制不变）。

停止：前端停止按钮对 image 请求直接 abort fetch；服务端 `request.signal` 中断上游调用，已写入的 user 消息保留，assistant 消息记 stopped（若已落库）。首发接受"abort 后服务端只写 user 消息"的简化，若实测体感差再补 stopped 消息。

## 4. 前端

- **composer**：选中模型的 `outputModalities` 含 image 时进入生图模式：
  - 隐藏 reasoning effort、search mode、附件按钮（首发生图不收附件）；
  - 显示生图参数弹层：尺寸 select（能力表档位 + freeform 时含"自定义"输入）、数量 stepper（1..nMax）、质量 select（有 qualities 时）；
  - 发送时请求体带 `image` 参数。
- **model pick**（R10）：image 模型加图标标识（数据已有，纯展示）。
- **MessageList**：assistant 消息的图片 file part 内联渲染（用户附件的图片渲染已存在，复用同一组件/分支；若现有渲染按 role 区分则需放开 assistant）。
- i18n：新增 `image.*` 键，en + zh-CN 同步。

- **旁路响应携带 `data-topic` 数据块**，前端标题触发点原样命中。
- **标题模型短路**：`title.service.ts` 的兜底 pair 是 composer 当前选中的模型，选中生图模型时 `generateText` 注定失败（现有 catch 会退化为文本截断标题）。在 `createChatModelHandle` 前检查该模型 `outputModalities` 含 `image` → 跳过 LLM 直接用 `fallbackTitleFromMessage`，避免一次必败调用 + 15s 超时。用户显式把 title 偏好设为生图模型不拦（catch 兑底）。

## 5. 数据流总览

```
composer(image model + params)
  → POST /api/chat { ..., image: {size,n,quality} }
  → requireModelForActor (selected.outputModalities 判定)
  → generateImageForEndpoint ──→ 厂商端点
  → file.service 落盘 + files 行（配额）
  → appendAssistantMessage(parts: [file...]) 
  → UI message stream (单条完整消息) → 前端既有消费/落缓存逻辑
```

## 兼容性 / 回滚

- 无 schema 迁移；files、chat_messages、配额全部复用。
- 请求 schema 新增字段全部 optional，旧客户端不受影响。
- 回滚 = revert；已生成的图片就是普通 files 行 + file part，无残留结构。

## 明确不做的设计（防膨胀）

- 不做"生图参数持久化到 assistant 消息 metadata 供一键复用"（后续可加，YAGNI）。
- 不做 image 模型的 stream 进度模拟（单 spinner 即可）。
- 不把能力表做成 DB 配置（静态代码表 + 自定义尺寸输入已覆盖长尾）。
