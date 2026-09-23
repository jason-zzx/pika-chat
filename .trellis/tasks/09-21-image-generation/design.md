# Design — 聊天内生图功能

## 总体形态

一套后端 image service（按 `apiFormat` 分发适配器）+ 聊天管线的一条非流式旁路 + composer 的生图参数 UI。不新增数据表，不改动 streamText 主管线。

## 1. 能力表（isomorphic）

新增 `src/lib/image-capabilities.ts`（client-safe，同 `provider-format.ts` 的定位）：

```ts
export type ImageSizeMode = "openai-size" | "aspect-ratio" | "freeform";
export type ImageFreeformConstraints = {
  divisibleBy?: number;   // 宽高均需整除（gpt-image-2/2.5: 16）
  ratioMin?: number;      // 最小宽高比 w/h
  ratioMax?: number;      // 最大宽高比
  maxSide?: number;       // 单边上限（gpt-image-2: 3840）
  minPixels?: number;     // 总像素下限（seedream-4.5: 3,686,400；qwen-image-2/3: 512×512）
  maxPixels?: number;     // 总像素上限（seedream: 4096×4096；qwen-image-2/3: 2048×2048）
};
export type ImageModelCapability = {
  sizeMode: ImageSizeMode;
  // openai-size: 像素档如 "1024x1024"；aspect-ratio: 如 "1:1"；freeform: 预设档 + 允许任意 "WxH"
  sizes: string[];
  nMax: number;
  qualities?: string[];          // 如 ["low","medium","high"]，仅 OpenAI 系
  imageSizes?: string[];         // 如 ["1K","2K","4K"]，Gemini imageSize
  freeform?: ImageFreeformConstraints;  // 仅 freeform 模式；缺省 = 无约束
};
export function imageCapabilityFor(modelId: string): ImageModelCapability; // 模式匹配 → 命中项，否则 DEFAULT_IMAGE_CAPABILITY
```
`ImageFreeformConstraints` 字段：`divisibleBy` / `ratioMin` / `ratioMax` / `minSide` / `maxSide` / `minPixels` / `maxPixels`（`minSide`/`maxSide` 为单边像素限，`minPixels`/`maxPixels` 为总像素限，全可选）。`freeformRules()` 把约束转成规则描述供 UI 提示（info 图标 Tooltip）；`validateFreeformSize()` 两端共用。

- 按 modelId 末段小写 substring/正则匹配，顺序即优先级。初始收录：gpt-image 系（拆三条）、dall-e-3、dall-e-2、gemini *image（Nano Banana 系）、seedream 系、qwen-image / wanx 系。
- gpt-image 系拆分（依据 2026-09 官方文档实测参数；匹配顺序即下列顺序，前缀更长的规则必须在前，因为 `gpt-image-2.5-flare` 同时包含 `gpt-image-2`）：
  1. `gpt-image-2.5-*`（flare / sunburst）：**freeform** + 约束 `{ divisibleBy: 16, ratioMin: 1/3, ratioMax: 3, maxSide: 3840 }`，qualities `["low","medium","high","xhigh","max","auto"]`，nMax 10；
  2. `gpt-image-2`（含 `-2026-04-21` 快照）：**freeform** + 同上约束（官方：任意 WxH、宽高整除 16、宽高比 1:3~3:1、>2560x1440 实验性、上限 3840x2160），qualities `["low","medium","high","auto"]`，nMax 10；
  3. `gpt-image-1 / 1.5 / 1-mini`：openai-size 固定三档（1024x1024 / 1536x1024 / 1024x1536），qualities `["low","medium","high","auto"]`，nMax 10（官方 n 范围 1–10，仅 dall-e-3 限 1）。
- `DEFAULT_IMAGE_CAPABILITY`：freeform（无约束），5 个常用宽高比预设 + nMax 1 + 自定义尺寸输入。
- 前端用它渲染参数选项；后端用它做发送前校验（非法档位 → 400）。**freeform 带约束时两端都要校验约束**（`image-params.ts` 发送前 sanitize + picker 自定义输入校验；`turn.ts` 服务端兜底），不满足 div/比例/上限的自定义值 → 400 `image.invalidParams`。

以下家族表按 2026-09 官方文档校准（gemini / seedream / qwen 拆分）：

- **Gemini**（aspect-ratio 模式；匹配顺序即下列顺序）：
  1. `gemini-3.1-flash-image` / `gemini-3-pro-image`（Nano Banana 2 / Pro）：15 种比例（10 基础 + `1:4` `4:1` `1:8` `8:1` `9:21`），imageSizes `["1K","2K","4K"]`。3.1-flash-image 的 512 档命名不确定（cloud 文档写 "512"，preview 实测 `"512px"` 不生效），暂不收录。
  2. 其余 gemini image（`gemini-2.5-flash-image`、`gemini-3.1-flash-lite-image`）：10 种比例，imageSizes **`["1K"]`**（这两模型只支持 1K，发 2K/4K 会被上游 400）。
- **Seedream**（freeform；ark id 形如 `doubao-seedream-4-5-251128`，网关也见 `seedream-4.5` 点分形式，两种都要匹配）：
  1. `seedream-5-0-pro`：nMax 1（官方仅单图），不加像素约束（文档仅给关键词档 1K/2K）；
  2. `seedream-5-0-lite` / `seedream-4-5`：`{ minPixels: 3_686_400, maxPixels: 16_777_216 }`（1024×1024 会被拒）；
  3. `seedream-4-0`：`{ minPixels: 921_600, maxPixels: 16_777_216 }`（1280×720 ~ 4096×4096）。
  seedream 的 size 还接受 `"2K"`/`"4K"` 关键词——**有意不建模**，关键词只是预设的别名，WxH 显式值全版本可用；宽高比范围各网关说法不一（[1/3,3] vs [1/16,16]），不写死，交给上游报错透传。
- **Qwen / Wan**（匹配顺序即下列顺序）：
  1. `qwen-image-2.0*` / `qwen-image-3.0*`（含 `-pro`）：freeform `{ minPixels: 262_144, maxPixels: 4_194_304 }`（512² ~ 2048²），nMax 6；
  2. `qwen-image` / `-plus` / `-max`（固定档家族）：openai-size 5 档 `["1328x1328","1664x928","928x1664","1472x1104","1104x1472"]`（**1104 不是 1140**，正好 4:3/3:4），nMax 4；
  3. **Wan 系拆分**（2026-09 阿里云文档核实：t2i-v2 参考 + 万相 2.7 API 参考。旧实现把 `wanx` 并进 qwen 固定档是错的——5 档预设中 4 个超出 wanx2.1 的 1440 单边限，必然 400）：
     - `wan2.7-image-pro`：freeform `{ minPixels: 589_824, maxPixels: 16_777_216, ratioMin: 1/8, ratioMax: 8 }`（768² ~ 4096²，文生图场景），nMax 4；
     - 其余 `wan2.*`（`wan2.7-image`、2.5/2.6 等）：freeform 同上但 `maxPixels: 4_194_304`（2048²；2.7-image 精确匹配，2.5/2.6 比例实为 [1:4,4:1]，我们给 1:8 偏宽松，上游 400 兜底），nMax 4。注意 `wan2.` 不含 "wanx" 子串，两条规则都必须是 includes 匹配；
     - `wanx*`（wanx2.1-t2i-turbo/plus、wanx-v1 等 2.2 及以下）：freeform `{ minSide: 512, maxSide: 1440 }`（官方：每边 [512,1440]，默认 1024*1024），nMax 4。
- dall-e-2 的 nMax 升 10（官方 n 范围 1–10，仅 dall-e-3 限 1）。

## 2. 后端 image service

新增 `src/server/ai/image/`：

```
image/generate.ts        generateImageForEndpoint() + per-format 适配器（Record<ProviderApiFormat, ... | null>，claude 为 null，同 provider-factory 的穷举键风格）+ 参数 → 厂商 payload 映射
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
- **google**：`POST {baseUrl}/models/{model}:generateContent`，`generationConfig.responseModalities: ["TEXT","IMAGE"]`，`imageConfig.aspectRatio` / `imageSize` 按能力表映射；解析 `candidates[].content.parts` 中 `inlineData`（图）与 `text`（文）——**`thought: true` 的思考 part 必须跳过**（Gemini 3 系会返回；schema 加 `thought: z.boolean().nullish()`，收集文本时排除，否则思考内容混进 assistant 消息正文）。响应 schema 一律 `.nullish()`（provider-configs spec 的网关兼容教训）。
- **b64 媒体类型嗅探**：openai 适配器 b64 分支不对 mediaType 硬编码 png——按文件头魔数嗅探（png/jpeg/webp/gif），嗅探不出才 fallback png。
- **`imageSize` 仅对 google 格式有意义**：openai-compatible 适配器不认识分辨率档；`turn.ts` 在非 google 格式下把 `imageSize` 从参数中剥除（带注释），避免"用户选了 2K 实际出 1K"的静默偏差通过校验层。
- **claude**：适配器为 `null`，调用方在更早处拦截（见 §3）。
- 错误映射沿用 `provider-error.ts` 约定：状态码 → `provider.*` 键，上游 body 的 message 摘要不回显敏感信息，但参数类 400 的合法值列表允许透传（R4）。适配器自己抛出的 `AppError`（如 `provider.unexpectedResponse`：网关返回 200 但 parts 为空/结构不符）经 `describeProviderError` **原样透传** code/messageKey——不能落入非 APICallError 分支被误映射为 `provider.unreachable`（2026-09-21 newapi 排障实录）。
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
5. 每张图：`file.service` 写 storage + 建 files 行（owner = actor，计配额，mediaType 按实际，走 `assertUploadQuota`）。**生成图跳过 `maxFileBytes` 单文件上限**（4K 档 PNG 可超 20 MiB；上传上限防的是用户文件，付费生成结果不能落库失败——配额断言保留），`uploadFile` 加可选参数表达；**批量生成中途失败（配额不足/abort/上游错）时，已落库的图片做 best-effort `deleteFile` 清理**，不留孤儿行计配额到 24h sweep。
6. `appendAssistantMessage`：parts = 图片 file parts（`url: /api/files/<id>`）+ 可选 text part；metadata 记 providerConfigId/modelId/outcome。
7. 失败：`appendAssistantMessage` outcome=failed + errorMessage（与流式失败的消息形态一致）。
8. 响应：**复用 UI message stream 协议**（`createUIMessageStream` 写入完整 assistant message 后 finish），前端消费路径零改动。这是关键决策——避免为单发响应造第二套前端协议。

regenerate 路由做同样分支（它接收 providerConfigId/modelId，重新解析能力后走 image 路径，版本组机制不变）。**图片参数继承规则与 chat 一致**：chat 的重新生成用 composer 当前的 model/effort/searchMode，image 模式同样把 composer 当前 draftKey 下的 `imageParams`（经 `imageRequestParams` sanitize）带进 regenerate body；session store 整页刷新后丢失 → 退化为默认参数，与 draft 文本的生命周期一致。不做“replay 原消息参数”（那需要把参数存进消息 metadata，且与现有产品语义冲突）。

停止：前端停止按钮对 image 请求直接 abort fetch；服务端 `request.signal` 中断上游调用，已写入的 user 消息保留，assistant 消息记 stopped（若已落库）。首发接受"abort 后服务端只写 user 消息"的简化，若实测体感差再补 stopped 消息。

## 4. 前端

- **composer**：选中模型的 `outputModalities` 含 image 时进入生图模式：
  - 隐藏 reasoning effort、search mode、附件按钮（首发生图不收附件）；
  - 显示生图参数弹层：尺寸 select（能力表档位 + freeform 时含"自定义"输入）、数量 stepper（1..nMax）、质量 select（有 qualities 时）；
  - **自定义尺寸的规则提示用 info 图标 + Tooltip**（base-ui Tooltip，hover/focus 触发；触屏聚焦可开）：仅当当前族的 `freeform` 约束非空时显示，内容由能力表约束动态生成（divisibleBy / ratioMin~ratioMax / maxSide / minPixels~maxPixels 四类规则，4 个 ICU 键，" · "连接；ratio 显示为 `1:3 ~ 3:1` 形式，像素值用 `toLocaleString`）。不合规输入的行内错误样式保留不变，图标提示是"规则说明"而不是错误本身（不违反"错误不藏在 tooltip 里"的约定）。无约束的 DEFAULT 族不显示图标。
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
