# Research: AI SDK v7 Streaming API (ai@7.0.85 / @ai-sdk/react@4.0.88)

- **Query**: streamText Route Handler + 服务端权威消息持久化 + useChat 前端，针对已锁定版本 `ai@7.0.85` / `@ai-sdk/react@4.0.88`
- **Scope**: mixed（本地 `.d.ts` 源码 + ai-sdk.dev 官方 v7 文档 + npm registry 元数据）
- **Date**: 2026-09-01

## 证据来源约定

本文每条结论都标注来源：

- `[D]` = **文档确认**（ai-sdk.dev，页面顶部标示 `v7 (Latest)`）
- `[T]` = **本地类型定义确认**（`node_modules/.../index.d.ts` + 行号，最可靠）
- `[N]` = **npm registry 元数据确认**
- `[?]` = **推测 / 未确认**（已明确标注）

本地类型定义路径：

- `node_modules/ai/dist/index.d.ts`（9582 行，`ai@7.0.85`）
- `node_modules/@ai-sdk/react/dist/index.d.ts`（329 行，`@ai-sdk/react@4.0.88`）
- `node_modules/.pnpm/@ai-sdk+provider@4.0.9/node_modules/@ai-sdk/provider/dist/index.d.ts`
- `@ai-sdk/openai-compatible@3.0.41` 未安装，类型定义经 `https://unpkg.com/@ai-sdk/openai-compatible@3.0.41/dist/index.d.ts` 抓取核对

---

## 1. 版本对应关系（结论段）

### 1.1 代际映射表

`ai` / `@ai-sdk/react` / `@ai-sdk/openai-compatible` 三者 major 号不一致，但 npm dist-tag 把代际关系标得很清楚 `[N]`：

| 代际 | dist-tag | `ai` | `@ai-sdk/react` | `@ai-sdk/openai-compatible` | `@ai-sdk/provider` | `@ai-sdk/provider-utils` |
|---|---|---|---|---|---|---|
| AI SDK 5 | `ai-v5` | 5.0.250 | **2**.0.253 | **1**.0.53 | 2.0.3 | 3.0.36 |
| AI SDK 6 | `ai-v6` | 6.0.273 | **3**.0.276 | **2**.0.74 | 3.0.15 | 4.0.50 |
| AI SDK 7 | `latest` | 7.0.87 | **4**.0.90 | **3**.0.41 | 4.0.9 | 5.0.34 |

（表中 `ai`/`react` 数字是查询当天 2026-09-01 各 tag 指向的版本；本项目锁的 `ai@7.0.85` / `@ai-sdk/react@4.0.88` 属于同一 `latest` 线，只是略早几个 patch。）

### 1.2 `ai@7` 对应哪条文档线

**对应 ai-sdk.dev 的 `v7 (Latest)`** `[D]`。抓取 <https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence> 与 <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>，页面侧栏均显示 `v7 (Latest)` / `AI SDK 7.x`，且代码示例与本地 `.d.ts` 一致（用 `toUIMessageStream` + `createUIMessageStreamResponse`）。所以**直接读 ai-sdk.dev 默认（不带版本前缀）的文档即可**，不需要切换版本。

### 1.3 为什么 `@ai-sdk/react` major 号是 4 而不是 7

`@ai-sdk/react` 有自己独立的 major 序列，**稳定地比 `ai` 落后 3 个 major**（v5→react 2、v6→react 3、v7→react 4）`[N]`。这是历史版本线错位，不是版本不匹配。

**最硬的配对证据** `[T]` — `node_modules/@ai-sdk/react/package.json`：

```json
{
  "version": "4.0.88",
  "dependencies": {
    "ai": "7.0.85",
    "@ai-sdk/provider": "4.0.9",
    "@ai-sdk/provider-utils": "5.0.34",
    "@ai-sdk/mcp": "2.0.41",
    "swr": "^2.4.1",
    "throttleit": "2.1.0"
  },
  "peerDependencies": { "react": "^18 || ~19.0.1 || ~19.1.2 || ^19.2.1" }
}
```

`@ai-sdk/react@4.0.88` **精确固定**（非 range）依赖 `ai@7.0.85`。项目当前 `package.json` 里的 `ai: 7.0.85` + `@ai-sdk/react: 4.0.88` 是完全匹配的一对，`react@19.2.8` 也满足 `^19.2.1` peer。

`@ai-sdk/react` 从 `ai` 重导出 `UIMessage`、`CreateUIMessage`、`UseCompletionOptions` `[T: react/index.d.ts:3]`，所以两包共用同一份 `UIMessage` 类型定义，不会有结构性冲突。

### 1.4 `@ai-sdk/openai-compatible` 该装哪个版本

**结论：`@ai-sdk/openai-compatible@3.0.41`（精确锁定，不加 `^`，与项目现有依赖写法一致）。**

依据 `[N]`（`npm view @ai-sdk/openai-compatible@<v> dependencies`）：

| 版本 | `@ai-sdk/provider` | `@ai-sdk/provider-utils` | 与 `ai@7.0.85` |
|---|---|---|---|
| **3.0.41** | **4.0.9** | **5.0.34** | ✅ 完全一致 |
| 2.0.74 | 3.0.15 | 4.0.50 | ❌ provider V3 |
| 1.0.53 | 2.0.3 | 3.0.36 | ❌ provider V2 |

`ai@7.0.85` 自身固定 `@ai-sdk/provider@4.0.9` + `@ai-sdk/provider-utils@5.0.34` `[T: ai/package.json]`。`3.0.41` 固定的是**同样这两个版本号**，因此 pnpm 会完全 dedupe，不会出现两份 provider。

这一点很关键，因为 provider 接口是**按版本号命名**的：`3.0.41` 的 provider 返回 `LanguageModelV4` / `ProviderV4` `[T: oaic:310-321]`，而 `ai@7` 的 `LanguageModel` 类型也期望 V4。装 `2.0.74` 会拿到 `LanguageModelV3`，类型不兼容。

`zod` peer 是 `^3.25.76 || ^4.1.8`，项目的 `zod@4.5.4` 满足 `[N]`。

安装命令：

```bash
pnpm add @ai-sdk/openai-compatible@3.0.41
```

---

## 2. `streamText` 的确切 API（ai@7.0.85）

### 2.1 函数签名位置

`[T: ai/index.d.ts:3450]` — `declare function streamText<TOOLS, RUNTIME_CONTEXT, OUTPUT>({...}): StreamTextResult<...>`

**`streamText` 不是 async 函数**，它同步返回 `StreamTextResult`，内部流是懒执行的。不要 `await streamText(...)`。

### 2.2 核心参数

| 参数 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `model` | `LanguageModel` | 必填 | `[T:3454]` |
| `messages` | `Array<ModelMessage>` | 与 `prompt` 二选一 | `[T:715]` |
| `prompt` | `string \| Array<ModelMessage>` | 与 `messages` 二选一 | `[T:702]` |
| `instructions` | `Instructions` | **系统提示词（v7 推荐写法）** | `[T:680]` |
| `system` | `Instructions` | ⚠️ **已 @deprecated → 用 `instructions`** | `[T:685]` |
| `allowSystemInMessages` | `boolean` | 默认 `false`；为 false 时 messages 里不允许 system 角色 | `[T:695]` |
| `temperature` | `number` | | `[T:533]` |
| `maxOutputTokens` | `number` | ⚠️ **不叫 `maxTokens`** | `[T:527]` |
| `topP` / `topK` / `presencePenalty` / `frequencyPenalty` / `stopSequences` / `seed` | | | `[T:542–576]` |
| `abortSignal` | `AbortSignal` | | `[T:650]` |
| `maxRetries` | `number` | 默认 `2` | `[T:646]` |
| `timeout` | `TimeoutConfiguration` | `{ totalMs?, stepMs?, firstChunkMs?, chunkMs?, toolMs? }` | `[T:657, 598–603]` |
| `headers` | `Record<string, string \| undefined>` | 仅 HTTP provider | `[T:655]` |
| `stopWhen` | `Arrayable<StopCondition>` | 默认 `isStepCount(1)`，即单步不自动循环 | `[T:3465]` |
| `providerOptions` | `ProviderOptions` | provider 专属参数 | `[T:3480]` |

`system` 被弃用是本代一个容易忽略的变化 —— 传 `system` 仍然能跑（只是 deprecated 警告），但新代码应该用 `instructions`。

### 2.3 `messages` 接受什么类型：`ModelMessage[]`，不是 `UIMessage[]`

`[T:715]` `messages: Array<ModelMessage>`。**必须先用 `convertToModelMessages` 转换。**

两者区别：

| | `UIMessage` | `ModelMessage` |
|---|---|---|
| 用途 | 前端渲染 / 前后端传输 / **持久化** | 喂给模型 |
| 结构 | `{ id, role, metadata?, parts: UIMessagePart[] }` `[T:1841-1865]` | `{ role, content }`（system/user/assistant/tool 四种变体） |
| 有 `id` | ✅ | ❌ |
| 有 `metadata` | ✅（自定义泛型） | ❌ |
| 内容载体 | `parts[]`（text / reasoning / tool / file / source / data / step-start…） | `content`（string 或 part 数组，无 UI 状态） |
| 携带流式状态 | ✅（如 `TextUIPart.state: 'streaming' \| 'done'` `[T:1879]`） | ❌ |

`UIMessage` 是"富信息 + 可渲染 + 可回放"的超集，`ModelMessage` 是"喂模型的最小必要信息"。转换是**有损单向**的（`UIMessage → ModelMessage`），所以持久化必须存 `UIMessage`（见 §5.2）。

### 2.4 `onFinish` → 已被 `onEnd` 取代

⚠️ **`streamText` 的 `onFinish` 在 ai@7 里是 @deprecated 的** `[T:3480+119..121]`：

```ts
onEnd?: StreamTextOnEndCallback<...>;
/** @deprecated Use `onEnd` instead. */
onFinish?: StreamTextOnEndCallback<...>;
```

两者类型完全相同，只是名字换了。

`onEnd` 收到的是 `StreamTextEndEvent = GenerateTextEndEvent & { output? }` `[T:3365-3372]`，字段（`[T:3942-4031]`）：

| 字段 | 类型 | 备注 |
|---|---|---|
| `callId` | `string` | 关联同一次调用的各事件 |
| `text` | `string` | 最终步生成的文本 |
| `content` | `ContentPart[]` | 所有步的内容 |
| `usage` | `LanguageModelUsage` | 全部步累加 |
| `totalUsage` | `LanguageModelUsage` | ⚠️ @deprecated → 用 `usage` |
| `finishReason` | `FinishReason` | 归一化后的结束原因 |
| `rawFinishReason` | `string \| undefined` | provider 原始值 |
| `responseMessages` | `ResponseMessage[]` | ⚠️ 是**顶层** `responseMessages`，**不是** `response.messages` |
| `steps` | `StepResult[]` | 全部步 |
| `finalStep` | `StepResult` | = `steps.at(-1)`；`request`/`response`/`providerMetadata`/`reasoning` 现在都推荐从这里取 |
| `warnings` | `CallWarning[] \| undefined` | 例如"不支持的参数" |
| `model` | | 最终步实际用的模型信息 |
| `response` / `request` / `providerMetadata` / `reasoning` / `reasoningText` / `toolsContext` / `runtimeContext` | | ⚠️ 全部 @deprecated → 用 `finalStep.*` |

**注意：`onEnd` 里拿不到完整的 `UIMessage`（带 `parts`）**，只有 ModelMessage 形态的 `responseMessages`。这是持久化不该挂在这一层的根本原因（详见 §3.4）。

### 2.5 `abortSignal` / 客户端断开

- `abortSignal?: AbortSignal` `[T:650]`，Route Handler 里可传 `req.signal`。
- `onAbort?: ({ steps }) => ...` `[T:3378-3383]` — 只给到"已完成的步"，**没有** `text`。
- ⚠️ **传了 `req.signal` 就等于"客户端断开则放弃生成"**，与"断开后仍要持久化"的目标冲突。要服务端权威持久化，就**不要**把 `req.signal` 传给 `streamText`，改用 `consumeStream()`（§3.5）。

### 2.6 其它回调机制

全部 `[T:3480+92..210]` / `[T:3354-3383]`：

- `onError?: ({ error }) => void` — 观测用；**不会**阻止错误进入流
- `onChunk?: ({ chunk })` — 每个 `TextStreamPart`
- `onAbort?: ({ steps })`
- `onStart` / `onStepStart` / `onStepEnd` / `onLanguageModelCallStart` / `onLanguageModelCallEnd` / `onToolExecutionStart` / `onToolExecutionEnd`
- ⚠️ 一批旧名已弃用：`onStepFinish`→`onStepEnd`、`experimental_onStart`→`onStart`、`experimental_telemetry`→`telemetry`、`includeRawChunks`→`include.rawChunks`

`consumeStream` 有两个形态：

- **方法** `result.consumeStream(options?: { onError? }): PromiseLike<void>` `[T:2818]`
- **独立函数** `consumeStream({ stream, onError?, abortSignal? }): Promise<void>` `[T:7590]`

持久化场景用**方法**形态。

---

## 3. Route Handler 返回流式响应的正确方式（ai@7.0.85）

### 3.1 `toDataStreamResponse()` 已经不存在

`[T]` 在 `ai/dist/index.d.ts` 全文 grep `toDataStreamResponse`：**零匹配**。这是 AI SDK 3/4 时代的 API，v5 起改名，v7 已彻底移除。

### 3.2 `toUIMessageStreamResponse()` 存在，但已 @deprecated

`[T:2850-2859]`：

```ts
/**
 * @deprecated Use the standalone `toUIMessageStream` and
 *   `createUIMessageStreamResponse` helpers from `'ai'` with `result.stream`
 *   instead. This method will be removed in the next major release.
 */
toUIMessageStreamResponse<UI_MESSAGE extends UIMessage>(
  options?: UIMessageStreamResponseInit & UIMessageStreamOptions<UI_MESSAGE>
): Response;
```

同批被弃用的还有 `result.toUIMessageStream()` `[T:2828]`、`result.pipeUIMessageStreamToResponse()` `[T:2836]`、`result.pipeTextStreamToResponse()` `[T:2849]`、`result.toTextStreamResponse()` `[T:2870]`。

**这一代的推荐写法是"独立 helper + `result.stream`"**，`[D]` 官方持久化文档所有示例都已切换到这个形态。**新代码应直接用推荐写法**，避免下个 major 返工。

### 3.3 推荐组合与签名

```ts
// [T:6090] 把 streamText 的原始流转成 UI message chunk 流
declare function toUIMessageStream<TOOLS, UI_MESSAGE>(options: {
  stream: ReadableStream<TextStreamPart<TOOLS>>;
  tools?: TOOLS;
} & UIMessageStreamOptions<UI_MESSAGE>): ReadableStream<InferUIMessageChunk<UI_MESSAGE>>;

// [T:6017] 包成 HTTP Response（SSE）
declare function createUIMessageStreamResponse(options: UIMessageStreamResponseInit & {
  stream: ReadableStream<UIMessageChunk>;
}): Response;
```

`UIMessageStreamOptions` 全字段 `[T:2550-2606]`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `originalMessages` | `UI_MESSAGE[]` | **传了才进入"持久化模式"**，才会给响应消息分配 id |
| `generateMessageId` | `IdGenerator` | 服务端生成 assistant 消息 id |
| `onEnd` | `UIMessageStreamOnEndCallback` | **持久化挂这里** |
| `onFinish` | 同上 | ⚠️ @deprecated → `onEnd` |
| `messageMetadata` | `({ part }) => METADATA \| undefined` | 在 `start` / `finish` 时被调用 |
| `sendReasoning` | `boolean` | 默认 **true** |
| `sendSources` | `boolean` | 默认 false |
| `sendStart` / `sendFinish` | `boolean` | 默认 true；多段流拼接时才关 |
| `onError` | `(error: unknown) => string` | 默认返回 `'An error occurred.'`（脱敏） |

`UIMessageStreamResponseInit = ResponseInit & { consumeSseStream? }` `[T:2514-2523]` — 可加自定义 `status` / `headers`。

`UI_MESSAGE_STREAM_HEADERS` `[T:6095-6102]` 是 SDK 内置的响应头常量（`content-type`、`cache-control`、`connection`、`x-vercel-ai-ui-message-stream`、`x-accel-buffering`），`createUIMessageStreamResponse` 会自动带上，一般不用手写。

### 3.4 持久化的官方推荐模式：挂在 `toUIMessageStream` 的 `onEnd`

**结论：挂 `toUIMessageStream({ onEnd })`（或 `createUIMessageStream({ onEnd })`），不要挂 `streamText({ onEnd })`。**

`[D]` 持久化文档原文：

> "Storing messages is done in the `onEnd` callback of the `toUIMessageStream` function. `onEnd` receives the complete messages including the new AI response as `UIMessage[]`."

两层 `onEnd` 拿到的数据对比：

| | `streamText({ onEnd })` `[T:3942-4031]` | `toUIMessageStream({ onEnd })` `[T:2480-2508]` |
|---|---|---|
| `messages` | ❌ 无 | ✅ `UI_MESSAGE[]`（原历史 + 新回复，**带 `parts`**） |
| `responseMessage` | ❌ 无 | ✅ `UI_MESSAGE`（单条新回复） |
| `text` | ✅ `string` | ❌（在 `parts` 里） |
| `usage` | ✅ `LanguageModelUsage` | ❌（要经 `messageMetadata` 搬进 metadata） |
| `finishReason` | ✅ | ✅（`finishReason?`，可选） |
| `steps` / `finalStep` / `warnings` | ✅ | ❌ |
| `isAborted` | ❌ | ✅ |
| `isContinuation` | ❌ | ✅ 是否续写上一条 assistant 消息 |
| `outcome` | ❌ | ✅ `{status: 'completed'\|'failed'\|'aborted'\|'unknown', error?}` |
| 消息 id | ❌（无 UIMessage id 概念） | ✅（`generateMessageId` 生成的服务端 id） |

**为什么必须用 `toUIMessageStream` 那层**：官方推荐持久化 `UIMessage` 格式（§5.2），而只有这一层的 `onEnd` 能给出带 `parts` 和服务端 id 的完整 `UIMessage[]`。`streamText` 的 `onEnd` 只有 ModelMessage 形态，存下去会丢 `parts` 结构和 id，重新加载时无法还原成 `useChat` 能用的形状。

`onEnd` 的 `outcome` 字段（v7 新增）对本项目很有用：可以据此把消息标记为 `completed` / `failed` / `aborted`，避免把半截的失败回复当成正常消息存进去。

如果需要 usage / 模型名等信息，用 `messageMetadata` 把它们搬进 `UIMessage.metadata`，`onEnd` 里就能一并存下（见 §5.3）。

### 3.5 保证客户端断开后仍完成生成并持久化

**`result.consumeStream()`，不要 await，在 return 之前调用。**

`[D]` 官方"Handling client disconnects"章节：

> "By default, the AI SDK `streamText` function uses backpressure to the language model provider... when the client disconnects... the stream from the LLM will be aborted... you can use the `consumeStream` method to consume the stream on the backend... `consumeStream` effectively removes the backpressure, meaning that the result is stored even when the client has already disconnected."

`[T:2810-2818]`：

> "Consumes the stream without processing the parts. This is useful to force the stream to finish. It effectively removes the backpressure and allows the stream to finish, triggering the `onEnd` callback and the promise resolution."

原理：`streamText` 默认对 provider 施加背压（客户端不读，就不向模型要 token）。客户端一断，读取停止 → 背压导致上游中断 → `onEnd` 永不触发 → 不持久化。`consumeStream()` 主动排空流，解除背压。

要点：

- **不要 `await`**（会阻塞 Response 返回，变成非流式）
- 官方示例位置：`streamText(...)` 之后、`return createUIMessageStreamResponse(...)` 之前
- 同时**不要**把 `req.signal` 传给 `streamText`（否则断开直接 abort，`consumeStream` 也救不回来）
- `waitUntil`：官方持久化文档**没有**提到 `waitUntil`，`consumeStream()` 就是官方答案。本项目自托管长驻 Node 进程，进程不会像 serverless 那样被冻结，`consumeStream()` 足够。`[?]` 未确认 `after()` / `waitUntil()` 在此场景是否有额外必要性——按官方文档不需要。
- 更强的断线恢复（客户端重连续读）需要 resumable stream，官方另有 "Chatbot Resume Streams" 文档 + `resume` / `resumeStream()` / `prepareReconnectToStreamRequest`。本次 MVP `[?]` 建议不做。

### 3.6 在响应里带自定义数据（如服务端生成的 message id）

三种方式：

**(a) `generateMessageId`（推荐，最省事）** `[D]` `[T:2562]`

```ts
toUIMessageStream({
  stream: result.stream,
  originalMessages: messages,
  generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
  onEnd: ({ messages }) => saveChat(messages),
})
```

id 会随 `start` chunk 下发给客户端，`onEnd` 的 `messages` 里也是同一个 id → **服务端权威且前后端一致**。

**(b) `createUIMessageStream` + 手写 `start` chunk（完全控制 id）** `[D]` `[T:5976-6003]`

```ts
declare function createUIMessageStream<UI_MESSAGE>(options: {
  execute: (options: { writer: UIMessageStreamWriterWithOutcome<UI_MESSAGE> }) => Promise<void> | void;
  onError?: (error: unknown) => string;
  originalMessages?: UI_MESSAGE[];
  onStepEnd?: ...;
  onEnd?: UIMessageStreamOnEndCallback<UI_MESSAGE>;
  onFinish?: ...;   // @deprecated → onEnd
  generateId?: IdGenerator;
}): ReadableStream<InferUIMessageChunk<UI_MESSAGE>>;
```

```ts
const stream = createUIMessageStream({
  execute: ({ writer }) => {
    writer.write({ type: 'start', messageId: myOwnId });   // 自己决定 id
    writer.merge(toUIMessageStream({ stream: result.stream, sendStart: false }));
  },
  originalMessages: messages,
  onEnd: ({ responseMessage }) => { /* save */ },
});
return createUIMessageStreamResponse({ stream });
```

**什么时候该用 `createUIMessageStream`**：需要往流里插入自定义 chunk（data part、多段 `streamText` 拼接、先发一段固定文案再接模型输出、id 来自数据库自增/UUID 而非随机生成）。只是要个服务端 id 的话，(a) 更简单。

注意 `writer.merge(...)` 时要 `sendStart: false`，否则会发出两个 `start`。

**(c) `messageMetadata`** — 把任意结构塞进 `UIMessage.metadata`，前端 `message.metadata` 直接读（§5.3）。

---

## 4. `useChat` 的确切 API（@ai-sdk/react@4.0.88）

### 4.1 签名

`[T: react/index.d.ts:132]`

```ts
declare function useChat<UI_MESSAGE extends UIMessage = UIMessage>(
  options?: UseChatOptions<UI_MESSAGE>
): UseChatHelpers<UI_MESSAGE>;

// [T: react:116-131]
type UseChatOptions<UI_MESSAGE> =
  ({ chat: Chat<UI_MESSAGE> } | ChatInit<UI_MESSAGE>) & {
    throttle?: number;
    experimental_throttle?: number;  // @deprecated → throttle
    resume?: boolean;
  };
```

### 4.2 参数（`ChatInit`）`[T: ai/index.d.ts:5502-5546]`

```ts
interface ChatInit<UI_MESSAGE extends UIMessage> {
  id?: string;
  messages?: UI_MESSAGE[];
  messageMetadataSchema?: FlexibleSchema<UI_MESSAGE['metadata']>;
  dataPartSchemas?: UIDataTypesToSchemas<...>;
  generateId?: IdGenerator;
  transport?: ChatTransport<UI_MESSAGE>;
  onError?: ChatOnErrorCallback;
  onToolCall?: ChatOnToolCallCallback<UI_MESSAGE>;
  onFinish?: ChatOnFinishCallback<UI_MESSAGE>;
  onData?: ChatOnDataCallback<UI_MESSAGE>;
  sendAutomaticallyWhen?: (options: { messages: UI_MESSAGE[] }) => boolean | PromiseLike<boolean>;
}
```

> ⚠️ **文档与类型不一致（重要）**：<https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat> 的 Parameters 段把 `api` / `credentials` / `headers` / `body` / `fetch` / `prepareSendMessagesRequest` 列成了 `useChat` 的顶层参数。**在 `@ai-sdk/react@4.0.88` 的实际类型里这些字段不存在于 `ChatInit`**，它们属于 `HttpChatTransportInitOptions` `[T:5694-5739]`。
>
> 运行时印证 `[T: react/dist/index.js:302-316]`：`useChat` 只从 options 里取 `onToolCall`/`onData`/`onFinish`/`onError`/`sendAutomaticallyWhen`/`transport`，无 transport 时 fallback 到 `new DefaultChatTransport()`（**不传任何参数**）。所以顶层写 `api` 会被静默忽略，请求打到默认的 `/api/chat`。
>
> **必须通过 `transport: new DefaultChatTransport({ ... })` 配置 URL / body / headers。** 官方的教程类页面（chatbot、persistence）示例都是正确的 transport 写法，只有 reference 页那张参数表是旧的。

### 4.3 返回值（`UseChatHelpers`）`[T: react/index.d.ts:102-114]`

```ts
type UseChatHelpers<UI_MESSAGE extends UIMessage> = {
  readonly id: string;
  setMessages: (messages: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])) => void;
  error: Error | undefined;
} & Pick<AbstractChat<UI_MESSAGE>,
  | 'sendMessage' | 'regenerate' | 'stop' | 'resumeStream'
  | 'addToolResult' | 'addToolOutput' | 'addToolApprovalResponse'
  | 'status' | 'messages' | 'clearError'>;
```

完整清单：

| 返回值 | 类型 | 来源 |
|---|---|---|
| `id` | `string`（只读） | `[T: react:105]` |
| `messages` | `UI_MESSAGE[]` | `[T:5580]` |
| `status` | `ChatStatus` | `[T:5574]` |
| `error` | `Error \| undefined` | `[T: react:113]` |
| `sendMessage` | 见 §4.5 | `[T:5589-5604]` |
| `regenerate` | `({ messageId?: string } & ChatRequestOptions) => Promise<void>` | `[T:5609-5611]` |
| `stop` | `() => Promise<void>` | `[T:5627]` |
| `clearError` | `() => void` | `[T:5619]` |
| `setMessages` | `(msgs \| updater) => void` | `[T: react:112]` |
| `resumeStream` | `(options?: ChatRequestOptions) => Promise<void>` | `[T:5615]` |
| `addToolOutput` | `ChatAddToolOutputFunction` | `[T:5621]` |
| `addToolResult` | 同上 | ⚠️ @deprecated → `addToolOutput` `[T:5622-5623]` |
| `addToolApprovalResponse` | | `[T:5620]` |

### 4.4 `input` / `handleInputChange` / `handleSubmit`：**已全部移除**

`[T]` `UseChatHelpers` 里**没有** `input`、`setInput`、`handleInputChange`、`handleSubmit`、`append`、`reload`、`isLoading`、`data`、`setData`。

`[D]` reference 页顶部明确说明：

> "The `useChat` API has been significantly updated in AI SDK 5.0. It now uses a transport-based architecture and **no longer manages input state internally**."

**输入框状态自己用 `useState` 管，提交时调 `sendMessage({ text })`。** `[D]` 官方示例：

```tsx
const { messages, sendMessage, status } = useChat({ /* ... */ });
const [input, setInput] = useState('');

<form onSubmit={e => {
  e.preventDefault();
  if (input.trim()) { sendMessage({ text: input }); setInput(''); }
}}>
```

注意 `useCompletion`（同包）**仍然**保留 `input`/`handleInputChange`/`handleSubmit`/`isLoading` `[T: react:151-176]` —— 别把两个 hook 的 API 记混。

### 4.5 `sendMessage` 签名 `[T:5589-5604]`

```ts
sendMessage: (
  message?:
    | (CreateUIMessage<UI_MESSAGE> & { text?: never; files?: never; messageId?: string })
    | { text: string; files?: FileList | FileUIPart[]; metadata?: ...; parts?: never; messageId?: string }
    | { files: FileList | FileUIPart[]; metadata?: ...; parts?: never; messageId?: string },
  options?: ChatRequestOptions
) => Promise<void>;
```

三种互斥形态：完整 `CreateUIMessage`（自己拼 `parts`）/ `{ text }` 快捷式 / 纯 `{ files }`。`messageId` 可指定 → **传了就是替换该消息**（编辑重发场景）。

`ChatRequestOptions` = `{ headers?, body?, metadata? }`，可做**单次请求**的参数覆盖 —— 例如临时切模型：

```ts
sendMessage({ text: input }, { body: { modelId: selectedModelId } });
```

### 4.6 `status` 取值 `[T:5468]`

```ts
type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';
```

`[T:5567-5573]` / `[D]` 语义：

- `submitted` — 已发出请求，等待流开始（此时该显示 spinner，还没有 token）
- `streaming` — **正在流式输出**
- `ready` — **已完成**，可以提交下一条
- `error` — 请求出错

区分"正在流式输出"和"已完成"：

```ts
const isStreaming = status === 'submitted' || status === 'streaming';  // 该显示 Stop 按钮
const canSubmit  = status === 'ready';                                 // 该允许发送
```

`[D]` 官方惯例：`stop` 按钮 `disabled={!(status === 'streaming' || status === 'submitted')}`；`regenerate` 按钮 `disabled={!(status === 'ready' || status === 'error')}`。

### 4.7 传入初始历史消息：用 `messages`，不是 `initialMessages`

`[T:5510]` `ChatInit.messages?: UI_MESSAGE[]`。**`initialMessages` 这个参数名在 ai@7 已不存在**（那是 v4 时代的名字）。

`[D]` 官方示例（注意变量名叫 `initialMessages` 只是**组件 prop 名**，传给 hook 时 key 是 `messages`）：

```tsx
export default function Chat({ id, initialMessages }: { id?: string; initialMessages?: UIMessage[] }) {
  const { sendMessage, messages } = useChat({
    id,
    messages: initialMessages,          // ← key 是 messages
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
}
```

`[T: react:96]` `Chat` 类构造器 `constructor({ messages, ...init }: ChatInit)` —— `messages` 只作为**初始值**读取一次，后续靠 `setMessages` 更新。切换会话要靠 `id` 变化（或 `key` 重挂组件）。

### 4.8 `transport` / `DefaultChatTransport`

存在 `[T:5755]`：

```ts
declare class DefaultChatTransport<UI_MESSAGE extends UIMessage> extends HttpChatTransport<UI_MESSAGE> {
  constructor(options?: HttpChatTransportInitOptions<UI_MESSAGE>);
}
```

`HttpChatTransportInitOptions` `[T:5694-5739]`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `api` | `string` | 默认 `'/api/chat'` |
| `credentials` | `Resolvable<RequestCredentials>` | 默认 `'same-origin'` |
| `headers` | `Resolvable<Record<string,string> \| Headers>` | **`Resolvable` = 静态值 / 同步函数 / async 函数**，适合动态 token |
| `body` | `Resolvable<object>` | 附加到请求体 |
| `fetch` | `FetchFunction` | 自定义 fetch |
| `prepareSendMessagesRequest` | `PrepareSendMessagesRequest` | 完全改写请求 |
| `prepareReconnectToStreamRequest` | `PrepareReconnectToStreamRequest` | 断线重连用 |

同族还有 `TextStreamChatTransport`（纯文本流）`[T:5824]` 和 `DirectChatTransport`（进程内直连 Agent，不走 HTTP）`[T:5791]`。本项目用 `DefaultChatTransport`。

带上 `topicId` / 选中 model 有两种做法：

```ts
// 静态附加（每次请求都带）
transport: new DefaultChatTransport({
  api: '/api/chat',
  body: { topicId, modelId },
})

// 完全控制请求体（推荐：只发最后一条，省流量）
transport: new DefaultChatTransport({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages, id, trigger, messageId }) => ({
    body: { chatId: id, trigger, messageId, message: messages[messages.length - 1], modelId },
  }),
})
```

`PrepareSendMessagesRequest` 入参 `[T:5651-5672]`：`{ id, messages, requestMetadata, body, credentials, headers, api, trigger, messageId }`；返回 `{ body, headers?, credentials?, api? }`（可 async）。

> ⚠️ **文档与类型不一致**：`[T:5660]` 明确 `trigger: 'submit-message' | 'regenerate-message'`，但 `[D]` chatbot 文档的 `prepareSendMessagesRequest` 示例里写的是 `'submit-user-message'` / `'regenerate-assistant-message'`，并且示例还带 `throw new Error(\`Unsupported trigger\`)` 兜底 —— **照抄那段文档会 100% 抛错**。以 `.d.ts` 为准。

### 4.9 消息 ID 生成与"服务端权威"

`[D]` 原文：

> "By default, message IDs are generated client-side: User message IDs are generated by the `useChat` hook on the client; AI response message IDs are generated by `streamText` on the server."
>
> "The server-side options below control IDs for generated **assistant** response messages. **User message IDs are created by `useChat` before the request is sent** to your API route, so keep those client-generated IDs when saving incoming request messages, or generate and persist your own user message IDs before sending/storing them."

所以要做到服务端权威，两类消息要分别处理：

- **assistant 消息** → 服务端 `generateMessageId`（或手写 `start` chunk）完全可控 ✅
- **user 消息** → 客户端 `useChat` 在发请求前就生成了 id。官方给两个选项：
  1. **接受客户端 id**（保存时沿用），配合服务端校验格式 —— 最简单
  2. **服务端重新生成并持久化**自己的 user id —— 但客户端内存里那条消息仍是旧 id，会不一致，除非刷新页面重载

> **本项目建议 `[?]`（这是推断，非文档结论）**：user 消息在服务端重新生成 id（数据库权威），assistant 用 `generateMessageId`。因为 §4.8 已经用 `prepareSendMessagesRequest` 只发最后一条，服务端本来就要写入这条 user 消息，顺手换 id 成本很低；客户端那条消息 id 不一致只影响"编辑/删除单条"这类操作，MVP 阶段可接受，或用 `onFinish` + `setMessages` 校正。规划时需要明确决策。

`useChat` 侧也可自定义客户端 id 生成器 `[D]`：

```ts
useChat({ generateId: createIdGenerator({ prefix: 'msgc', size: 16 }) })
```

`createIdGenerator` / `generateId` 均从 `'ai'` 导出（转自 `@ai-sdk/provider-utils`）`[T: ai/index.d.ts:7]`。

### 4.10 渲染 `parts`

`UIMessagePart` 全部变体 `[T:1866]`：

```
TextUIPart | CustomContentUIPart | ReasoningUIPart | ToolUIPart | DynamicToolUIPart
| SourceUrlUIPart | SourceDocumentUIPart | FileUIPart | ReasoningFileUIPart
| DataUIPart | StepStartUIPart
```

本次需要关心的：

- `TextUIPart` `[T:1870-1884]` — `{ type: 'text', text: string, state?: 'streaming' | 'done', providerMetadata? }`。`state` 可用来给正在输出的段落加光标效果。
- `ReasoningUIPart` `[T:1902+]` — `{ type: 'reasoning', id?, text, ... }`。需服务端 `sendReasoning: true`（**默认就是 true** `[T:2580]`）。

`ai` 还导出一批类型守卫，比手写 `part.type === 'x'` 更稳 `[T:9582 export list]`：`isTextUIPart`、`isReasoningUIPart`、`isFileUIPart`、`isToolUIPart`、`isDataUIPart`、`isReasoningFileUIPart`、`isDynamicToolUIPart`、`isStaticToolUIPart`、`isCustomContentUIPart`。

`[D]` 官方渲染写法：

```tsx
{messages.map(message => (
  <div key={message.id}>
    {message.role === 'user' ? 'User: ' : 'AI: '}
    {message.parts.map((part, index) => {
      if (part.type === 'text') return <div key={index}>{part.text}</div>;
      if (part.type === 'reasoning') return <pre key={index}>{part.text}</pre>;
      return null;
    })}
  </div>
))}
```

`parts.map` 用 index 作 key 是官方示例的做法（part 无稳定 id）。TS strict 下 `.map` 回调必须所有分支都有返回值，末尾要显式 `return null`。

---

## 5. `UIMessage` 与 `ModelMessage` 的转换

### 5.1 `convertToModelMessages` —— 注意它是 async

`[T:5645-5649]`：

```ts
declare function convertToModelMessages<UI_MESSAGE extends UIMessage>(
  messages: Array<Omit<UI_MESSAGE, 'id'>>,
  options?: {
    tools?: ToolSet;
    ignoreIncompleteToolCalls?: boolean;   // 默认 false
    convertDataPart?: (part: DataUIPart<...>) => TextPart | FilePart | undefined;
  }
): Promise<ModelMessage[]>;     // ← Promise！
```

⚠️ **返回 `Promise<ModelMessage[]>`，必须 `await`。**

> **文档自相矛盾**：`[D]` 同一批页面里两种写法都出现过 —— 持久化文档"Storing messages"节写 `messages: await convertToModelMessages(messages)`（正确），而"Validation with tools"节写 `messages: convertToModelMessages(validatedMessages)`（漏了 await）。**以 `.d.ts` 为准，必须 await**，否则会把一个 Promise 传给 `messages`，TS strict 下直接类型报错（好在编译期就能发现）。

参数类型是 `Array<Omit<UI_MESSAGE, 'id'>>` —— 传完整的 `UIMessage[]` 也兼容（多一个 `id` 字段没问题）。

配套的服务端校验 `[T:5908-5931]`：

```ts
type ValidateUIMessagesOptions<UI_MESSAGE> = {
  messages: unknown;                    // 接受 unknown，适合直接喂 req.json() 的结果
  metadataSchema?: FlexibleSchema<UIMessage['metadata']>;
  dataSchemas?: { ... };
  tools?: { ... };
};
declare function validateUIMessages<UI_MESSAGE>(o): Promise<Array<UI_MESSAGE>>;      // 抛错
declare function safeValidateUIMessages<UI_MESSAGE>(o): Promise<SafeValidateUIMessagesResult<UI_MESSAGE>>;  // { success, data | error }
```

`[D]` 只在"消息含 tool calls / 自定义 metadata / data parts"时才要求 validate。本项目 MVP 无 tools，但既然 `metadata` 要存 usage（§5.3），且历史来自数据库 JSON，**建议用 `safeValidateUIMessages` + `metadataSchema`（zod）做一层防腐**，schema 演进时不会因为老数据直接 500。`[D]` 官方还给了 `TypeValidationError` 的降级示例（catch 后退化为空历史）。

### 5.2 数据库该存什么形状：存 `UIMessage`（parts JSON）

**官方明确推荐存 `UIMessage` 格式** `[D]`：

> "The `useChat` message format is different from the `ModelMessage` format. The `useChat` message format is designed for frontend display, and contains additional fields such as `id` and `createdAt`. **We recommend storing the messages in the `useChat` message format.**"

（注：文中提到的 `createdAt` 在 ai@7 的 `UIMessage` 接口里**已经不存在** `[T:1841-1865]`，这句文档描述是旧的。需要时间戳得自己加数据库列或塞进 `metadata`。）

理由（`UIMessage → ModelMessage` 是有损单向转换）：

- 存 `UIMessage` → 喂 `streamText` 只需 `await convertToModelMessages(...)`；喂 `useChat` 直接 `messages={...}`，**两边都省事**
- 存纯 text → 丢掉 reasoning / tool / file / metadata / part 边界，无法还原前端渲染，且未来加多模态要重做数据模型

落到本项目的建议形状 `[?]`（推断，非文档结论）：

```
messages 表:
  id            text PRIMARY KEY        -- UIMessage.id（服务端权威）
  topic_id      text NOT NULL           -- 外键，用于查询/排序
  role          text NOT NULL           -- 'user' | 'assistant' | 'system'
  parts         jsonb NOT NULL          -- UIMessagePart[] 原样存
  metadata      jsonb                   -- UIMessage.metadata（usage / modelId / ...）
  created_at    timestamptz NOT NULL
```

`role` / `topic_id` 提升为独立列便于索引和查询，`parts` / `metadata` 存 jsonb 原样透传。读出时组装成 `UIMessage` 即可两端复用。

`onEnd` 的 `messages` 是**完整数组**（含全部历史），所以持久化实现要么"整会话 upsert"，要么用 `responseMessage` 只写新增那条 —— 后者对增量写入更友好，且配合 `outcome` 可以按结果决定是否落库。

### 5.3 `UIMessage` 的 TS 结构与 `metadata` 用法

`[T:1841-1865]`：

```ts
interface UIMessage<
  METADATA = unknown,
  DATA_PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools
> {
  id: string;
  role: 'system' | 'user' | 'assistant';   // 注意：没有 'tool'
  metadata?: METADATA;
  parts: Array<UIMessagePart<DATA_PARTS, TOOLS>>;
}
```

`metadata` 是第一个泛型参数，用来放"不属于对话内容、但要跟随消息"的信息（token usage、模型名、耗时）。

`[D]` 官方 usage 模式 —— 服务端定义类型并用 `messageMetadata` 注入：

```ts
type MyMetadata = { totalUsage: LanguageModelUsage };
export type MyUIMessage = UIMessage<MyMetadata>;

toUIMessageStream({
  stream: result.stream,
  originalMessages: messages,
  messageMetadata: ({ part }) => {
    if (part.type === 'finish') {
      return { totalUsage: part.totalUsage };
    }
  },
})
```

⚠️ 这里字段名是 **`part.totalUsage`** `[T:2975-2979]`（`TextStreamFinishPart = { type:'finish', finishReason, rawFinishReason, totalUsage }`），**不是 `part.usage`**。虽然 `onEnd` 事件对象上的 `totalUsage` 已弃用（改叫 `usage`），但 stream part 上仍叫 `totalUsage`。**两个地方名字不一样，容易搞混。**

`messageMetadata` 在 `start` 和 `finish` 两个时机被调用 `[T:2571]`，返回 `undefined` 表示该时机不附加（TS strict 下 `if` 不匹配时隐式返回 `undefined`，类型是 `METADATA | undefined`，OK）。

`LanguageModelUsage` 结构 `[T:320-370]`：

```ts
type LanguageModelUsage = {
  inputTokens: number | undefined;
  inputTokenDetails: {
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
  outputTokenDetails: { reasoningTokens: number | undefined };
  totalTokens: number | undefined;
};
```

⚠️ 所有数值字段都是 `number | undefined` —— TS strict 下入库前必须处理 undefined（OpenAI-compatible 的第三方端点经常不回 usage；`createOpenAICompatible` 记得开 `includeUsage: true`，否则**流式响应默认不带 usage** `[T: oaic:352-354]`）。

客户端消费：`message.metadata?.totalUsage?.totalTokens`，或在 `useChat({ onFinish: ({ message }) => ... })` 里读 `[D]`。

前端要享受 metadata 类型推断，需要把自定义类型传给 hook：`useChat<MyUIMessage>({ ... })` `[D]`。类型定义放在 `src/lib/schemas/` 之类的共享位置比从 route 文件导出更符合本项目现有分层（`src/lib/schemas/` 已有 6 个 schema 文件）。

---

## 6. `@ai-sdk/openai-compatible@3.0.41` 用法

### 6.1 `createOpenAICompatible` 签名

`[T: oaic:384]`

```ts
declare function createOpenAICompatible<
  CHAT_MODEL_IDS extends string,
  COMPLETION_MODEL_IDS extends string,
  EMBEDDING_MODEL_IDS extends string,
  IMAGE_MODEL_IDS extends string
>(options: OpenAICompatibleProviderSettings):
  OpenAICompatibleProvider<CHAT_MODEL_IDS, COMPLETION_MODEL_IDS, EMBEDDING_MODEL_IDS, IMAGE_MODEL_IDS>;
```

`OpenAICompatibleProviderSettings` `[T: oaic:322-360+]`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `baseURL` | `string` | ✅ | API 调用的 URL 前缀 |
| `name` | `string` | ✅ | provider 名（用于错误信息 / telemetry） |
| `apiKey` | `string` | ✗ | 自动加 `Authorization: Bearer <apiKey>` |
| `headers` | `Record<string,string>` | ✗ | 在 apiKey header **之后**追加 |
| `queryParams` | `Record<string,string>` | ✗ | 追加 URL query（如 Azure `api-version`） |
| `fetch` | `FetchFunction` | ✗ | 自定义 fetch |
| `includeUsage` | `boolean` | ✗ | **流式响应带 usage，默认 undefined(false)** |
| `supportsStructuredOutputs` | `boolean` | ✗ | | 
| `supportedUrls` | `() => Record<string, RegExp[]>` | ✗ | 允许直传的 URL |
| `transformRequestBody` | `(args) => Record<string, any>` | ✗ | 代理类端点改写请求体 |
| `metadataExtractor` | `MetadataExtractor` | ✗ | 抽取 provider 专属 metadata |

⚠️ `name` 和 `baseURL` 都是**必填**（无 `?`）。

### 6.2 拿 chat model 实例

`[T: oaic:310-321]`

```ts
interface OpenAICompatibleProvider<...> extends ProviderV4 {
  (modelId: CHAT_MODEL_IDS): LanguageModelV4;                                    // 直接调用
  languageModel(modelId, config?: Partial<OpenAICompatibleChatConfig>): LanguageModelV4;
  chatModel(modelId: CHAT_MODEL_IDS): LanguageModelV4;
  completionModel(modelId): LanguageModelV4;
  embeddingModel(modelId): EmbeddingModelV4;
  textEmbeddingModel(modelId): EmbeddingModelV4;   // @deprecated → embeddingModel
  imageModel(modelId): ImageModelV4;
}
```

**`provider(id)`、`provider.chatModel(id)`、`provider.languageModel(id)` 三者等价**，都返回 chat language model `[D]`：

> - `provider.languageModel('model-id')` - creates a chat language model (same as `provider('model-id')`)
> - `provider.chatModel('model-id')` - creates a chat language model

推荐 `provider.chatModel(id)`（意图最明确）。

### 6.3 `baseURL` 是否要含 `/v1`

**要包含。** `[D]` 官方全部示例都是 `baseURL: 'https://api.provider.com/v1'`。

`baseURL` 是"URL 前缀"，provider 在其后拼 `/chat/completions`。所以：

- `https://api.openai.com/v1` → `https://api.openai.com/v1/chat/completions` ✅
- `https://api.openai.com` → `https://api.openai.com/chat/completions` ❌

本项目让用户在设置里填 baseUrl，**UI 上应明确提示要填到 `/v1`**（或在服务端做规范化）。这是自托管场景最高频的配置错误之一。

### 6.4 最小代码示例：从加密存储实例化 model

```ts
// src/server/ai/provider-instance.ts
import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

type ResolvedProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey: string; // 调用方负责先 AES-256-GCM 解密
};

export function createChatModel(
  config: ResolvedProviderConfig,
  modelId: string,
): LanguageModel {
  const provider = createOpenAICompatible({
    name: config.name,
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    includeUsage: true, // 否则流式响应拿不到 token usage
  });

  return provider.chatModel(modelId);
}
```

`LanguageModel` 从 `'ai'` 导入 `[T:9582]`；`provider.chatModel()` 返回的 `LanguageModelV4` 可赋值给它。

---

## 7. 错误处理

### 7.1 流已开始后出错 → `onError` 返回字符串

`[T:2600-2605]` `UIMessageStreamOptions.onError`：

```ts
/**
 * Process an error, e.g. to log it. Default to `() => 'An error occurred.'`.
 * @returns error message to include in the data stream.
 */
onError?: (error: unknown) => string;
```

`[D]`：

> "By default, the error message is masked for security reasons. The default error message is 'An error occurred.' You can forward error messages or send your own error message by providing an `onError` function"

**默认脱敏**（防止泄露服务端细节），返回的字符串会作为 error part 写入流，客户端 `useChat` 的 `error` 能拿到。

`[D]` 官方示例：

```ts
toUIMessageStream({
  stream: result.stream,
  onError: error => {
    if (error == null) return 'unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return JSON.stringify(error);
  },
})
```

⚠️ 直接照抄这段会**把 provider 原始错误信息透给浏览器**（可能含 baseUrl、上游响应体）。本项目应映射成用户友好的分类文案（§7.3），细节只进 pino 日志。

区分三层 error 钩子（别搞混）：

| 钩子 | 位置 | 作用 |
|---|---|---|
| `streamText({ onError })` | `[T:3354]` | **只观测**（`({error}) => void`），不影响流 |
| `toUIMessageStream({ onError })` | `[T:2605]` | **决定发给客户端的错误文案**（返回 string） |
| `createUIMessageStream({ onError })` | `[T:5981]` | 同上，用 `createUIMessageStream` 时 |

日志记在 `streamText.onError`，用户文案在 `toUIMessageStream.onError`。

流未开始就出错（如解密失败、无权限、模型不存在）→ 正常 `throw` / 返回非 200 `Response`，走项目现有的 `src/app/api/_lib/with-error-handling.ts`。

### 7.2 客户端拿错误

- `error: Error | undefined` `[T: react:113]`
- `clearError(): void` `[T:5619]` — 清除 error 并把 status 复位为 ready
- `onError?: (error: Error) => void` `[T:5520]`
- `status === 'error'`

`[D]` 官方建议 + 惯例：

```tsx
{error && (
  <>
    <div>An error occurred.</div>
    <button type="button" onClick={() => regenerate()}>Retry</button>
  </>
)}
```

> `[D]` "We recommend showing a generic error message to the user, such as 'Something went wrong.' This is a good practice to avoid leaking information from the server."

### 7.3 判断 401 / 超时 / 模型不存在

`APICallError` 从 `'ai'` 直接导出（转自 `@ai-sdk/provider`）`[T: ai/index.d.ts:2]`。结构 `[T: provider:774-787]`：

```ts
declare class APICallError extends AISDKError {
  readonly url: string;
  readonly requestBodyValues: unknown;
  readonly statusCode?: number;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: string;
  readonly isRetryable: boolean;
  readonly data?: unknown;
  static isInstance(error: unknown): error is APICallError;
}
```

**用静态方法 `APICallError.isInstance(e)` 而不是 `instanceof`** —— SDK 用 symbol marker 实现，跨包/跨副本更可靠。

`ai` 还导出这些错误类 `[T: ai/index.d.ts:2]`：`AISDKError`、`APICallError`、`EmptyResponseBodyError`、`InvalidPromptError`、`InvalidResponseDataError`、`JSONParseError`、`LoadAPIKeyError`、`LoadSettingError`、`NoContentGeneratedError`、`NoSuchModelError`、`NoSuchProviderReferenceError`、`TooManyEmbeddingValuesForCallError`、`TypeValidationError`、`UnsupportedFunctionalityError`。另有 SDK 层的 `RetryError`、`NoObjectGeneratedError`、`NoOutputGeneratedError`、`MessageConversionError`、`InvalidArgumentError` 等 `[T:9582]`。

分类判断（基于 `statusCode` 的映射是**通用 HTTP 语义推断** `[?]`，SDK 不做语义分类）：

```ts
import { APICallError } from "ai";

type ChatErrorKind =
  | "auth"          // 401/403：key 无效或无权限
  | "not-found"     // 404：模型不存在 / baseUrl 路径错
  | "rate-limit"    // 429
  | "timeout"       // 超时 / abort
  | "upstream"      // 5xx
  | "unknown";

export function classifyChatError(error: unknown): ChatErrorKind {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) return "auth";
    if (status === 404) return "not-found";
    if (status === 429) return "rate-limit";
    if (status !== undefined && status >= 500) return "upstream";
    return "unknown";
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "timeout";
  }
  return "unknown";
}
```

注意点：

- **404 有歧义** —— 既可能是模型 id 不存在，也可能是 `baseURL` 少了 `/v1`。文案上最好同时提示两种可能，并把 `error.url` 记进日志。
- `error.isRetryable` 是 SDK 自己的重试判定（5xx / 429 类），可用于决定是否展示"重试"按钮。
- `maxRetries` 默认 2 `[T:646]`，意味着**瞬时错误已经被自动重试过 2 次**才抛到你手上。若被 `RetryError` 包裹，需要看 `cause` 才能拿到原始 `APICallError`。`[?]` 未确认 `RetryError` 是否总会包裹 —— 实现时建议同时检查 `error` 和 `error.cause`。
- 超时来源有两处：`timeout` 配置 `[T:657]` 和 `abortSignal`；两者都表现为 abort 类错误。
- `error.responseBody` 常含上游原始 JSON 错误 —— **只进日志，绝不回传给客户端**。

---

## 8. 陷阱清单

按"踩坑代价"排序。

### 严重（会导致功能静默失效 / 数据丢失）

1. **客户端断开不持久化** —— 忘了 `result.consumeStream()`。背压导致上游中断、`onEnd` 永不触发。必须调，且**不要 await**，放在 `return` 之前。`[D]`

2. **`consumeStream()` 和 `abortSignal: req.signal` 互相抵消** —— 传了 `req.signal`，客户端一断就直接 abort，`consumeStream` 救不回来。要服务端权威持久化就**别传 `req.signal`**。`[T:650]`

3. **持久化挂错层** —— 挂 `streamText({ onEnd })` 拿不到带 `parts` 的 `UIMessage[]`，只有 ModelMessage 形态的 `responseMessages`，存下去前端无法还原。必须挂 `toUIMessageStream({ onEnd })`。`[D]` `[T:2480 vs 3942]`

4. **忘传 `originalMessages`** —— 不传就不进入"持久化模式"，响应消息**不会分配 id** `[T:2552-2560]`，`onEnd.messages` 也不含历史。

5. **`useChat` 顶层写 `api` / `body` / `headers` 被静默忽略** —— `@ai-sdk/react@4.0.88` 的 `ChatInit` 没有这些字段，`useChat` fallback 到 `new DefaultChatTransport()`（无参数），请求打到默认 `/api/chat`，`topicId`/`modelId` **根本没发出去**。必须用 `transport: new DefaultChatTransport({...})`。**注意 reference 文档那张参数表是错的。** `[T:5502-5546 + react/index.js:302-316]`

### 类型 / 编译期（好在能被 TS strict 挡住）

6. **`convertToModelMessages` 是 async** —— 返回 `Promise<ModelMessage[]>`，必须 await。官方文档部分示例漏了 await。`[T:5649]`

7. **`messages` 类型混用** —— `streamText.messages` 只接受 `ModelMessage[]` `[T:715]`；`useChat.messages` 是 `UIMessage[]`。数据库存 `UIMessage`，喂模型前必须转换。

8. **`toDataStreamResponse()` 不存在** —— ai@7 全文零匹配。凭 v4 记忆写会直接报错。

9. **`result.toUIMessageStreamResponse()` 已 @deprecated** —— 能跑但下个 major 移除。新代码直接用 `createUIMessageStreamResponse({ stream: toUIMessageStream({...}) })`。`[T:2850-2859]`

10. **一批参数名被弃用/改名**，凭旧记忆写会拿到 deprecation 警告或类型错误：
    - `system` → **`instructions`** `[T:685]`
    - `maxTokens` → **`maxOutputTokens`**（不是 deprecated，是**根本不存在**）`[T:527]`
    - `streamText({ onFinish })` → `onEnd` `[T:3480+119]`
    - `toUIMessageStream({ onFinish })` → `onEnd` `[T:2565-2567]`
    - `onStepFinish` → `onStepEnd`；`totalUsage` → `usage`（事件对象上）
    - `initialMessages` → **`messages`**（`useChat`）`[T:5510]`
    - `addToolResult` → `addToolOutput` `[T:5622]`
    - `experimental_throttle` → `throttle`

11. **`useChat` 不再管理 input** —— 没有 `input`/`handleInputChange`/`handleSubmit`/`append`/`reload`/`isLoading`。自己 `useState` + `sendMessage({ text })`。注意同包的 `useCompletion` **仍有**这些，别记混。`[T: react:102-114 vs 151-176]`

### 数据 / 一致性

12. **`part.totalUsage` vs 事件对象的 `usage`** —— `messageMetadata` 回调里 stream part 上叫 **`part.totalUsage`** `[T:2978]`，而 `onEnd` 事件对象上 `totalUsage` 已弃用（改叫 `usage`）。同一个概念两个地方两个名字。

13. **`LanguageModelUsage` 全字段可能是 `undefined`** `[T:320-370]` —— 第三方 OpenAI-compatible 端点经常不回 usage。入库前处理 undefined，且 `createOpenAICompatible` 要开 **`includeUsage: true`**，否则流式响应默认不带 usage。`[T: oaic:352]`

14. **user 消息 id 是客户端生成的** —— `useChat` 在发请求前就生成了。要"服务端权威"必须显式决策：沿用客户端 id，还是服务端重新生成（会与客户端内存不一致）。`[D]` §4.9

15. **`baseURL` 必须含 `/v1`** —— 少了会 404（且会被误判成"模型不存在"）。UI 提示或服务端规范化。`[D]` §6.3

16. **`prepareSendMessagesRequest` 的 `trigger` 值** —— 实际是 `'submit-message'` / `'regenerate-message'` `[T:5660]`，但**官方 chatbot 文档示例写的是 `'submit-user-message'` / `'regenerate-assistant-message'` 且带 throw 兜底 —— 照抄必然抛错**。

17. **`onEnd.messages` 是完整数组** —— 含全部历史，不是增量。要么整会话 upsert，要么用 `responseMessage` 只写新增那条（推荐，配合 `outcome` 判断是否落库）。`[T:2480-2508]`

18. **`stopWhen` 默认 `isStepCount(1)`** `[T:3463]` —— 单步不自动多轮。本次无 tools 无影响，但将来加 tool calling 必须显式设置。

19. **`sendReasoning` 默认 true** `[T:2578-2580]` —— reasoning 模型的思维链会**默认下发到客户端**。若不想暴露，显式设 `false`。

### 平台 / 运行时

20. **不要给 chat route 加 `export const runtime = 'edge'`** —— 本项目用 `postgres`(node-postgres 系) + `pino` + Node crypto 做 AES-256-GCM 解密，都需要 Node runtime。Next.js App Router 的 Route Handler **默认就是 Node runtime**，保持默认即可。`[?]` 这是基于项目依赖的推断。

21. **流式响应的超时/缓冲** —— `export const maxDuration = N` 是 Next.js route segment config，主要对 Vercel 等 serverless 平台生效。**本项目是自托管**，真正会掐断长连接的是前置反代（nginx `proxy_read_timeout`、`proxy_buffering off`、`X-Accel-Buffering`）和 Node server 超时。`createUIMessageStreamResponse` 已自动带 `x-accel-buffering` 头 `[T:6095-6102]` 来抑制 nginx 缓冲。`[?]` 本项目的具体部署拓扑未确认，规划时需要确认反代配置。

22. **`messageMetadata` 返回 `undefined` 是合法的** `[T:2573-2575]` —— 只在 `start`/`finish` 时机被调用，其它情况返回 undefined 表示不附加。TS strict 下 `if` 不匹配时隐式返回 undefined，类型 OK。

---

## 9. 可直接抄用的最小代码示例

以下代码按 TypeScript strict 校对（显式类型标注、无隐式 any、可选值均处理）。**未经实际编译验证** `[?]` —— 本次研究不修改 `src/`。

### 9.1 Route Handler（`src/app/api/chat/route.ts`）

```ts
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from "ai";

// 与前端共享的自定义消息类型（建议放 src/lib/schemas/chat.ts）
export type ChatMetadata = {
  modelId?: string;
  totalTokens?: number;
};
export type ChatUIMessage = UIMessage<ChatMetadata>;

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json();

  // 用 zod 校验 body，拿到 topicId / modelId / 新的 user message
  const { topicId, modelId, message } = parseChatRequest(body);

  // 鉴权 + 载入历史（服务端权威）
  const actor = await requireActor();
  const previousMessages: ChatUIMessage[] = await loadTopicMessages(actor, topicId);

  // 服务端生成 user 消息 id 并落库
  const userMessage: ChatUIMessage = await appendUserMessage(actor, topicId, message);
  const messages: ChatUIMessage[] = [...previousMessages, userMessage];

  // 解密 API key 并实例化 model
  const model = await resolveChatModel(actor, modelId);

  const result = streamText({
    model,
    messages: await convertToModelMessages(messages), // 必须 await
    instructions: "You are a helpful assistant.",     // v7: 不是 system
    temperature: 0.7,
    // 注意：不传 abortSignal —— 客户端断开后仍要完成生成并持久化
    onError: ({ error }) => {
      logger.error({ err: error }, "streamText failed");
    },
  });

  // 解除背压：客户端断开也要跑完并触发 onEnd。不要 await。
  void result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, ChatUIMessage>({
      stream: result.stream,
      originalMessages: messages, // 必传，否则不进入持久化模式
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      messageMetadata: ({ part }) => {
        if (part.type === "finish") {
          return { modelId, totalTokens: part.totalUsage.totalTokens };
        }
        return undefined;
      },
      onEnd: async ({ responseMessage, outcome, isAborted }) => {
        if (outcome.status === "failed") {
          logger.warn({ topicId, outcome }, "stream failed, skip persist");
          return;
        }
        await saveAssistantMessage(topicId, responseMessage, { isAborted });
      },
      onError: (error: unknown) => {
        // 只回用户友好文案，细节仅进日志
        logger.error({ err: error }, "chat stream error");
        return toUserFacingMessage(classifyChatError(error));
      },
    }),
  });
}
```

### 9.2 前端（`src/components/topic/chat.tsx`）

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

import type { ChatUIMessage } from "@/lib/schemas/chat";

type ChatProps = {
  topicId: string;
  modelId: string;
  initialMessages: ChatUIMessage[];
};

export function Chat({ topicId, modelId, initialMessages }: ChatProps) {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, stop, error, regenerate } =
    useChat<ChatUIMessage>({
      id: topicId,
      messages: initialMessages, // 不是 initialMessages
      transport: new DefaultChatTransport({
        api: "/api/chat",
        // 只发最后一条，历史由服务端权威载入
        prepareSendMessagesRequest: ({ messages: msgs, id }) => ({
          body: {
            topicId: id,
            modelId,
            message: msgs[msgs.length - 1],
          },
        }),
      }),
    });

  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return <p key={index}>{part.text}</p>;
            }
            if (part.type === "reasoning") {
              return <pre key={index}>{part.text}</pre>;
            }
            return null;
          })}
          {message.metadata?.totalTokens !== undefined && (
            <span>{message.metadata.totalTokens} tokens</span>
          )}
        </div>
      ))}

      {error && (
        <div role="alert">
          <span>Something went wrong.</span>
          <button type="button" onClick={() => void regenerate()}>
            Retry
          </button>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = input.trim();
          if (trimmed.length === 0 || isStreaming) return;
          void sendMessage({ text: trimmed });
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button type="button" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={status !== "ready"}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
```

### 9.3 openai-compatible model 实例化

见 §6.4。

---

## 10. Caveats / 未确认

明确标注为**未确认**的项：

1. **`waitUntil` / `after()` 的必要性** —— 官方持久化文档只讲 `consumeStream()`，没提 `waitUntil`。本项目自托管长驻 Node 进程，理论上不需要。未在 Next.js 16 自托管环境实测。

2. **`RetryError` 是否总会包裹原始 `APICallError`** —— `maxRetries` 默认 2，重试耗尽后抛出的错误类型未逐一验证。实现错误分类时建议同时检查 `error` 与 `error.cause`。

3. **`statusCode` → 错误语义的映射** —— SDK 只给原始 `statusCode`，不做语义分类。§7.3 的映射是通用 HTTP 语义推断，各家 OpenAI-compatible 端点的实际状态码可能不同（例如有的把无效 key 返回 400 而非 401）。建议接入后按实际端点校准。

4. **Next.js 16 流式响应的 runtime / `maxDuration` 具体行为** —— 未查阅 Next.js 16.3.3 官方文档，仅基于依赖推断需要 Node runtime。自托管场景下反代配置（nginx buffering / read timeout）是更关键的变量，需确认部署拓扑。

5. **代码示例未编译验证** —— §9 的示例按 strict 规则人工校对，但本次研究不修改 `src/`，未跑 `tsc`。其中 `resolveChatModel` / `loadTopicMessages` / `saveAssistantMessage` / `parseChatRequest` / `requireActor` / `toUserFacingMessage` 等均为待实现的占位函数。`toUIMessageStream` 的第一个泛型参数签名是 `TOOLS extends ToolSet = ToolSet` `[T:6090]`，无 tools 时显式写 `ToolSet` 即可（示例已如此）；也可省略泛型依赖推断，但那样 `messageMetadata` 的返回类型推断会退化为默认 `UIMessage`，拿不到 `ChatMetadata` 约束。

6. **user 消息 id 策略** —— §4.9 的"服务端重新生成"建议是推断，不是官方结论。官方明确说 user id 由客户端生成，并建议"保留客户端 id"或"自己生成并持久化"，但没给出哪个更好。需要在规划阶段决策。

7. **数据库表形状** —— §5.2 的表结构是基于官方"存 UIMessage 格式"建议的推断，未与项目现有 Drizzle schema 约定（`src/server/db/schema/columns.ts` 等）对齐。项目目前**尚无** topic/message 表（`src/server/db/schema/` 只有 app-settings / assistant / auth / columns / provider），需新建。

## 11. 相关项目文件（供实现时参考）

| 路径 | 说明 |
|---|---|
| `src/server/ai/model-resolution.ts` | 已有 `resolveAvailableModels(actor)`，从 `providerConfigs` + `providerModels` 联表查可用模型（含 own/shared 可见性） |
| `src/server/ai/discovery.ts` | 已有的模型发现逻辑 |
| `src/app/api/_lib/with-error-handling.ts` | 现有 Route Handler 错误包装约定 |
| `src/lib/schemas/provider.ts` | `AvailableModel` 等类型 |
| `src/lib/schemas/topic.ts` | 已有 topic schema |
| `src/app/api/topics/route.ts`、`src/app/api/topics/[id]/route.ts` | 已有 topic CRUD |
| `src/app/(app)/t/[topicId]/` | 会话页面路由 |
| `src/server/db/schema/` | 目前无 message 表，需新建 |

相关 spec 文档（实现前应阅读）：

- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/auth-guidelines.md`
- `.trellis/spec/backend/logging-guidelines.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/type-safety.md`

## 12. 外部参考链接

- [Chatbot Message Persistence (v7)](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) — 持久化 / 消息 id / 客户端断开处理的权威来源
- [useChat reference (v7)](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat) — ⚠️ Parameters 段的 `api`/`body`/`headers` 已过时，见 §4.2
- [Chatbot guide (v7)](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot) — status / error / metadata / reasoning；⚠️ `trigger` 取值有误，见 §4.8
- [OpenAI Compatible Providers (v7)](https://ai-sdk.dev/providers/openai-compatible-providers) — `createOpenAICompatible` 设置项与 baseURL 约定
