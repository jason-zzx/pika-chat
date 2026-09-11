# 技术设计：供应商 API 格式扩充

> 对应 `prd.md`。范围：DB schema → 共享 Zod 契约 → AI provider 工厂 →
> builtin 搜索注入 → Discover → 服务层 → 表单 UI → i18n。

---

## 1. 现状（改动前的单点事实）

| 关注点 | 现状 |
|---|---|
| 建模型 | `src/server/ai/chat-model.ts:70` 硬编码 `createOpenAICompatible` |
| Discover | `src/server/ai/discovery.ts:33` 硬编码 `{baseUrl}/models` + `Bearer` + `{data:[{id}]}` |
| builtin 搜索 | `src/server/ai/builtin-search.ts` 只注入 `web_search_options`，URL 匹配 `/chat/completions` |
| 字段 | `src/lib/schemas/provider.ts` 的 `create/update/ownProviderConfigSchema` 只有 `name/baseUrl/apiKey/visibility` |
| 表单 | `src/components/provider/ProviderConfigForm.tsx` 原生 `<form>` + `FormData`，无状态 |
| 依赖 | 只装了 `@ai-sdk/openai-compatible@3.0.41`（peer `@ai-sdk/provider@4.0.9`） |

三处硬编码是本任务要拆开的三个扩展点。

---

## 2. 数据层

### 2.1 `src/server/db/schema/provider.ts`

```ts
export const providerApiFormat = pgEnum("provider_api_format", [
  "openai-compatible",
  "claude",
  "google",
]);
```

`provider_configs` 新增：

```ts
apiFormat: providerApiFormat("api_format").notNull().default("openai-compatible"),
```

不加索引（只在按 id 取用，无按格式过滤的查询）。

### 2.2 迁移

`pnpm db:generate` 生成 `0014_*.sql`。预期内容：`CREATE TYPE ... provider_api_format`
+ `ALTER TABLE provider_configs ADD COLUMN api_format ... NOT NULL DEFAULT
'openai-compatible'`。带 `DEFAULT` 的 `ADD COLUMN` 在 Postgres 11+ 不重写表，
大表也安全；已有行自动取默认值。

**回滚**：`DROP COLUMN api_format; DROP TYPE provider_api_format;`。代码侧因为
Zod 里 `apiFormat` 带 `.default()`，即使列还在、代码回退也能正常读写。

---

## 3. 共享契约（`src/lib/provider-format.ts` + `src/lib/schemas/provider.ts`）

### 3.1 新增 `src/lib/provider-format.ts`（共享层，禁止 `server-only`）

```ts
export const PROVIDER_API_FORMATS = [
  "openai-compatible",
  "claude",
  "google",
] as const;

export const providerApiFormatSchema = z.enum(PROVIDER_API_FORMATS);
export type ProviderApiFormat = z.infer<typeof providerApiFormatSchema>;

export const DEFAULT_PROVIDER_API_FORMAT: ProviderApiFormat = "openai-compatible";

export type ProviderFormatDefaults = {
  defaultBaseUrl: string;
  apiKeyRequired: boolean;
};

export const PROVIDER_FORMAT_DEFAULTS: Record<ProviderApiFormat, ProviderFormatDefaults> = {
  "openai-compatible": { defaultBaseUrl: "https://api.openai.com/v1",       apiKeyRequired: false },
  claude:              { defaultBaseUrl: "https://api.anthropic.com/v1",     apiKeyRequired: true  },
  google:              { defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKeyRequired: true },
};

export function requiresApiKey(format: ProviderApiFormat): boolean {
  return PROVIDER_FORMAT_DEFAULTS[format].apiKeyRequired;
}
```

单一事实来源：表单的 placeholder / 必填态、提交的默认 baseUrl、后端校验共用它。

### 3.2 `src/lib/schemas/provider.ts`

- `ownProviderConfigSchema` 增加 `apiFormat: providerApiFormatSchema`
- `createProviderConfigSchema` 增加 `apiFormat: providerApiFormatSchema.default(DEFAULT_PROVIDER_API_FORMAT)`
- `updateProviderConfigSchema` 增加 `apiFormat: providerApiFormatSchema.optional()`

**API Key 必填校验**：**目标格式需要 key 时，写入后必须存在 key**，否则拒绝
且不写库。规则由 `src/lib/provider-format.ts` 的纯函数承载：

```ts
export function requiresApiKey(format: ProviderApiFormat): boolean;
```

两条路径**都在服务层**（`provider.service.ts`），共用一个
`assertApiKeyAvailable(format, hasKey)`：

- **create** — `assertApiKeyAvailable(input.apiFormat, apiKey !== null)`。
  格式在 Zod default 应用后必存在。
- **update** — 在 `requireOwnedConfig` 之后、构造 `patch` 之前。
  `requireOwnedConfig` 已经把整行读出来了，所以这里**不产生额外查询**：

  ```ts
  const apiFormat = input.apiFormat ?? existing.apiFormat;
  const hasKey =
    input.apiKey === null
      ? false
      : (typeof input.apiKey === "string" && input.apiKey.length > 0) ||
        existing.encryptedApiKey !== null;
  assertApiKeyAvailable(apiFormat, hasKey);
  ```

其中"写入后是否还有 key"必须区分三种情况 —— 这是实现阶段被测试抓到的一个
真实 bug（最初写成 `incomingKey || hasStoredKey`，导致 `apiKey: null` 被误判为
"沿用存量 key"，于是 claude 配置的 key 被清空却放行）：显式 `null` 清空、
非空字符串替换、省略则沿用存量。（评审后 `keyPresentAfterPatch()` 这个
单调用点的辅助函数被内联到此处，规则改成注释承载。）

> **为什么两条路径都放服务层，而不是 create 走 Zod**：判定口径是"写入后是否存在
> key"，update 必须读存量行才能回答，而 create 的存量是空。放在一处才能保证
> create 与 update 的错误 key 一致（都是 `provider.apiKeyRequired`），也避免同一
> 规则在 Zod 与 service 两处各写一遍后漂移。Zod 只负责形状，`VALIDATION_FAILED`
> 的语义由服务层给。

需要新增 `provider.apiKeyRequired` 错误 message key（见 §8.3）。

---

## 4. 后端 provider 工厂

### 4.1 新增 `src/server/ai/provider-factory.ts`

```ts
export type ProviderEndpoint = {
  apiFormat: ProviderApiFormat;
  name: string;
  baseUrl: string;
  apiKey: string;
};

export function createLanguageModel(
  endpoint: ProviderEndpoint,
  modelId: string,
  options?: { builtinSearch?: boolean },
): LanguageModel
```

按格式分派：

| 格式 | 构造 | 取模型 | 备注 |
|---|---|---|---|
| `openai-compatible` | `createOpenAICompatible({ name, baseURL, apiKey: apiKey \|\| undefined, includeUsage: true, fetch? })` | `.chatModel(modelId)` | 与现状逐字一致 |
| `claude` | `createAnthropic({ baseURL, apiKey, fetch? })` | `provider(modelId)` | SDK 自带 `anthropic-version` 头 |
| `google` | `createGoogle({ baseURL, apiKey, fetch? })`（导出别名 `createGoogleGenerativeAI`） | `provider(modelId)` | SDK 走 `:streamGenerateContent` |

**已验证（读 `@ai-sdk/anthropic@4.0.52` / `@ai-sdk/google@4.0.67` 的 `dist/index.d.ts`）：**

- 两个 provider 都**没有 `.chatModel`**（只有 `languageModel` / `chat`），
  因此统一用可调用形式 `provider(modelId)`。openai-compatible 保持 `.chatModel`。
- `createAnthropic` / `createGoogle` 都接受 `baseURL` / `apiKey` / `headers` / `fetch`。
- 默认 baseURL 分别是 `https://api.anthropic.com/v1` 与
  `https://generativelanguage.googleapis.com/v1beta`，与 §3.1 的默认值表一致。
- `apiKey` 缺省时会回落到 `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`
  环境变量。我们始终显式传值（claude/google 必填），不依赖环境变量。

`fetch` 只在 `builtinSearch` 为真时挂上（格式感知，见 §5）。

### 4.2 `src/server/ai/chat-model.ts`

- `loadConfigRow` 的 select 增加 `apiFormat`。
- 删掉本地 `createOpenAICompatible` 调用，改为调 `createLanguageModel(...)`。
- 其余（所有权闸门、解密、`describeError`）完全不动。

---

## 5. builtin 搜索注入：`src/server/ai/builtin-search.ts`

`withBuiltinWebSearch` 签名变为
`withBuiltinWebSearch(format: ProviderApiFormat, base?: FetchFunction)`。

保留现有守卫：非 POST / 无 string body / 解析失败 / 非对象 → 原样透传。
在守卫通过后按格式决定**是否匹配该 URL** 与 **注入什么**：

```ts
const FORMAT_INJECTION = {
  "openai-compatible": {
    matches: (url) => url.includes("/chat/completions"),
    payload: () => ({ web_search_options: {} }),
  },
  claude: {
    matches: (url) => url.endsWith("/messages"),
    payload: () => ({
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  },
  google: {
    matches: (url) => url.includes("generatecontent"),
    payload: () => ({ tools: [{ googleSearch: {} }] }),
  },
} as const;
```

合并策略：只 `setIfAbsent` 语义的浅合并 ——

- openai：`{ ...parsed, web_search_options: {} }`（与现状一致，直接覆盖）
- claude / google：`{ ...parsed, tools: [...(Array.isArray(parsed.tools) ? parsed.tools : []), ...注入项] }`
  —— **追加**而非替换，避免把模型侧已有的 function declarations 抹掉。

`max_uses: 5` 提为具名常量 `ANTHROPIC_WEB_SEARCH_MAX_USES`。

`matches` 收到的 url 已 `toLowerCase()`。

> **google 必须大小写不敏感**：流式端点叫 `:streamGenerateContent`，非流式叫
> `:generateContent`。写成 `includes(":generateContent")` 在流式场景匹配不上，
> 搜索会静默失效。统一小写后比 `generatecontent`，两种都能覆盖。

`claude` 用 `endsWith("/messages")` 而非 `includes`，是为了排除
`/v1/messages/count_tokens`。

**为什么仍然是 fetch 包装而不是 providerOptions**：现有实现就是为了绕开
`@ai-sdk/openai-compatible` 对 `providerOptions` 的 zod 裁剪（见
`chat-search-tools.md`）。fetch 包装把三种格式收在同一个文件里，不碰
`streamText` 调用点，且可单测。沿用既有模式。

**已评估的替代方案（本次不采用）**：`@ai-sdk/anthropic` 与 `@ai-sdk/google`
都导出了 provider-executed 工具 —— `anthropic.tools.webSearch_20250305()` 与
`google.tools.googleSearch()`。那是 AI SDK 的原生做法，但要注册到 `streamText`
的 `tools` 上，意味着：

- `createChatModelHandle` 得额外返回 tools，改动横跨 chat 与 regenerate 两个路由；
- 会产生 `provider-executed` 类型的消息 part，牵动持久化 schema 与渲染
  （`uiPartsFromJson` 遇到未知 part 是逐项丢弃 —— 不崩，但历史里会缺内容）。

收益撑不起这个改动面，且会让 openai 与另两种格式用两套不同机制。记录在案，
若后续消息 part 管线本身要动，可以一并切换。

---

## 6. Discover：`src/server/ai/discovery.ts`

`fetchServedModelIds` 参数由 `(baseUrl, apiKey)` 改为对象：

```ts
export async function fetchServedModelIds(options: {
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  apiKey: string | null;
}): Promise<string[]>
```

| 格式 | 请求 | 解析 |
|---|---|---|
| openai-compatible | `GET {base}/models`，`Authorization: Bearer <key>`（无 key 时不带头） | `{data:[{id}]}` → `id` |
| claude | `GET {base}/models`，`x-api-key: <key>`，`anthropic-version: 2023-06-01` | `{data:[{id}]}` → `id` |
| google | `GET {base}/models`，`x-goog-api-key: <key>` | `{models:[{name, supportedGenerationMethods?}]}` → 剥 `models/` 前缀；若存在 `supportedGenerationMethods` 则只保留含 `generateContent` 的条目 |

- `ANTHROPIC_VERSION = "2023-06-01"` 具名常量。
- 超时 / 状态码 / 解析失败的错误分支与 message key 完全不动，只是函数签名变了。
- google 列表可能很长且含非生成式模型（embedding 等），按
  `supportedGenerationMethods` 过滤能直接让 Discover 结果可用。

调用方 `provider.service.ts:discoverProviderModels` 传入 `config.apiFormat`。

---

## 7. 服务层与路由

`src/server/services/provider.service.ts`：

- `toOwnConfig` 入参 `Pick` 增加 `"apiFormat"`，返回值增加 `apiFormat`。
- `loadOwnConfig` / `listProviderConfigs` 的 `.select({ config: {...} })` 两处
  投影都加上 `apiFormat: providerConfigs.apiFormat`。
- `createProviderConfig`：`.values({ ..., apiFormat: input.apiFormat })`，
  `.returning(...)` 投影加 `apiFormat`。
- `updateProviderConfig`：`patch` 类型加 `apiFormat?: ProviderApiFormat`，
  `input.apiFormat !== undefined` 时写入（与 `name`/`baseUrl` 同一模式）。
- `sharedProviderConfigSchema` **不加**格式 —— 共享配置只暴露模型列表，
  端点细节属于所有者。

路由 `src/app/api/providers/route.ts`、`[id]/route.ts` 已是把 zod 解析结果转交
service，预期无需改动；实施时确认一遍即可。

---

## 8. 前端

### 8.1 `src/components/provider/ProviderConfigForm.tsx`

现状是无状态 `FormData`。要支持"按格式动态渲染"，只引入最小状态：

```ts
const [format, setFormat] = useState<ProviderApiFormat>(
  initial?.apiFormat ?? DEFAULT_PROVIDER_API_FORMAT,
);
```

- **格式下拉**：`Select`（`components/ui/select.tsx`，照
  `ModelEditorDialog.tsx:379-412` 的 Select/Trigger/Value/Content/Item 用法）。
  trigger 必须给 `SelectValue` 子节点 —— Base UI 的 Select 默认把原始 `value`
  渲染进 trigger（i18n 规范 "Common pitfalls" 已记录），只翻译选项不够。
  `onValueChange` 收 `unknown`，用 `isProviderApiFormat()` 收窄，不要 `as`。
- **格式 label 的 key 映射** `PROVIDER_FORMAT_LABEL_KEYS`
  （`as const satisfies Record<ProviderApiFormat, string>`）从
  `ProviderConfigForm.tsx` 导出，表单与详情徽标共用，避免两处各写一份映射。
  （评审前曾单列为 `provider-format-labels.ts`，为一个 3 项映射开一个模块不划算。）
- **Base URL**：仍非受控（`defaultValue={initial?.baseUrl}`），
  `placeholder={PROVIDER_FORMAT_DEFAULTS[format].defaultBaseUrl}` 随格式变。
  **去掉 `required`**，改在提交时 `baseUrl: raw || PROVIDER_FORMAT_DEFAULTS[format].defaultBaseUrl`
  —— 这样"留空用默认"成立，非空时 `type="url"` 仍兜住格式校验。
- **API Key**：`required={requiresApiKey(format) && !isEdit}`
  （编辑态永远不 required —— 留空表示保留原 key，这是既有语义，§3.2 的服务端
  判定也据此放行）。创建态的 placeholder 也随格式切：必填格式用
  `apiKeyRequiredPlaceholder`，否则沿用 `apiKeyNewPlaceholder`
  —— 否则"Optional for local endpoints"会和 `required` 自相矛盾。
- `initial` prop 类型扩为
  `Pick<OwnProviderConfig, "name" | "baseUrl" | "apiFormat" | "visibility">`。
- 提交对象增加 `apiFormat: format`；创建成功后 `form.reset()` 之外还要
  `setFormat(DEFAULT_PROVIDER_API_FORMAT)`，因为 `reset()` 管不到受控的 Select。

不引入 react-hook-form（仓库没有该依赖，且 `ModelEditorDialog` 用的是 `useState`
风格，保持一致）。

### 8.2 `src/components/provider/ProviderConfigsScreen.tsx`

- 创建 / 编辑两处 `<ProviderConfigForm>` 的 `initial` 补上 `apiFormat`。
- `OwnProviderDetail` 的标题徽标行（visibility 徽标旁）加一个格式
  `SettingsBadge` —— 比放在 baseUrl 行更贴合既有视觉分组。

### 8.3 i18n

`messages/en.json` 与 `messages/zh-CN.json` 的 `Provider` 命名空间下新增：

```
apiFormatLabel, apiFormatPlaceholder,
formatOpenai, formatClaude, formatGoogle,
apiKeyRequiredPlaceholder
```

另外服务端错误 key `provider.apiKeyRequired` 加在 `messages/en.json` 与
`messages/zh-CN.json` 的 **`Errors.provider`** 下（与既有 `provider.nameTaken`
等并列，`en.json:466`）。`AppErrorMessageKey` 是从 message 目录推导出来的，
不需要改 `src/lib/api/error-contract.ts`。

现有 `baseUrlPlaceholder` 保留给 openai-compatible；claude / google 的 placeholder
直接来自 `PROVIDER_FORMAT_DEFAULTS`（URL 不需要翻译）。

**顺带修正的既有文案**（本任务让它们变成不准确的陈述）：

| key | 旧 | 新 |
|---|---|---|
| `Settings.Providers.description` | Connect OpenAI-compatible endpoints… | Connect provider endpoints… |
| `Provider.emptyDescription` | Add an OpenAI-compatible endpoint… | Add an endpoint… |
| `Provider.addProviderDescription` | Fill in the basics of an OpenAI-compatible endpoint. | Fill in the basics of the endpoint. |

两份 catalog 同时改，`pnpm typecheck` 会盯住。

---

## 9. 依赖

```
@ai-sdk/anthropic@^4.0.52
@ai-sdk/google@^4.0.67
```

两者都依赖 `@ai-sdk/provider@4.0.13`，与已装的
`@ai-sdk/openai-compatible@3.0.41`（`@ai-sdk/provider@4.0.9`）同属 v4 主线，
符合项目"ai@7 配 @ai-sdk/<provider>@4"的约定。peer 只有 `zod ^3.25.76 || ^4.1.8`，
与现状一致。

---

## 10. 兼容性

| 场景 | 行为 |
|---|---|
| 老供应商 | 列默认 `openai-compatible`，Discover / 聊天 / builtin 搜索行为逐字不变 |
| 老客户端不传 `apiFormat` 创建 | Zod default 兜住，建出来就是 openai-compatible |
| 老客户端 PATCH 不带 `apiFormat` | 保持原值（`updateProviderConfigSchema` 可选） |
| `sharedProviderConfigSchema` | 不变，共享配置不泄漏端点细节 |

## 11. 风险与显式接受的缺口

1. ~~`.chatModel` 是否为 anthropic/google v4 的公开 API~~ —— **已验证：没有**，
   改用 `provider(modelId)`（见 §4.1）。
2. ~~update 时"格式切到 claude/google 但库里本来没 key"不报错~~ —— **已闭合**。
   `requireOwnedConfig` 本就读出了整行，判定不需要额外查询；无 key 时直接 400
   且不写库（见 §3.2）。
3. **Google 端点形态多样**（官方 v1beta、OpenAI 兼容层、第三方代理）。本设计只
   承诺原生 Gemini 协议；如果用户把 Google 官方地址当成 openai-compatible 填，
   那是他选错了格式，UI 上有格式标识可自查。
4. **builtin 搜索在各家都是 best-effort**：注入字段不被识别时退化成普通补全，
   这是 `chat-search-tools.md` 已确立的语义，本任务不收紧。
5. **格式下拉的交互没有自动化覆盖**：Base UI 的 Select popup 依赖真实
   `PointerEvent`，jsdom 不具备（`pointerDown` 打不开；键盘 `ArrowDown` 能打开，
   所以"三种选项都在"已覆盖）。**"点击切换格式后 placeholder / 必填态变化"
   需要浏览器人工验收**。派生逻辑由
   `src/lib/provider-format.test.ts` 与
   `src/components/provider/ProviderConfigForm.test.tsx` 覆盖。
   不为测试给共享的 `vitest.dom.setup.ts` 加 PointerEvent polyfill —— 改动面
   不划算，记录在此。
