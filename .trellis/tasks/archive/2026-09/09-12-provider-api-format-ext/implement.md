# 执行计划：供应商 API 格式扩充

> 依据 `prd.md` / `design.md`。按顺序执行；每步结束都要能跑通验证命令。
> 任务分支：`main`（当前分支，干净）。如需隔离可先
> `git switch -c feat/provider-api-format`。

## 验证命令（每次改动后必跑）

```bash
pnpm lint
pnpm typecheck
pnpm test
```

集成测试需要 Postgres，起法见 `vitest.integration.setup.ts` /
`docker-compose.yml`。

---

## Step 1 — 安装依赖

- [ ] `pnpm add @ai-sdk/anthropic@^4.0.52 @ai-sdk/google@^4.0.67`
- [ ] `pnpm typecheck` 确认与 `ai@7.0.85` / `@ai-sdk/provider@4` 无 spec 冲突

**API 形态已验证完毕**（读 `dist/index.d.ts`，结论已回写 `design.md` §4.1）：

- 两个 provider **都没有 `.chatModel`** → 用可调用形式 `provider(modelId)`
- 工厂是 `createAnthropic` / `createGoogle`（`createGoogleGenerativeAI` 是其别名）
- 两者都接受 `baseURL` / `apiKey` / `headers` / `fetch`
- 默认 baseURL 与 `PROVIDER_FORMAT_DEFAULTS` 里的值一致

> ⛔ 回滚点：若 typecheck 报 spec 版本不匹配，停下改 `design.md` §9 的版本选型，
> 不要硬顶。

## Step 2 — 共享契约

- [ ] 新建 `src/lib/provider-format.ts`：
      `PROVIDER_API_FORMATS`、`providerApiFormatSchema`、
      `DEFAULT_PROVIDER_API_FORMAT`、`PROVIDER_FORMAT_DEFAULTS`
      （含 `defaultBaseUrl` / `apiKeyRequired`）、`requiresApiKey()`。
      不得 import `server-only`。
- [ ] `src/lib/schemas/provider.ts`：
      - `ownProviderConfigSchema` 加 `apiFormat`
      - `createProviderConfigSchema` 加 `apiFormat`（带 default）
      - `updateProviderConfigSchema` 加 `apiFormat`（optional）
      - `createProviderConfigSchema` 挂 superRefine：`requiresApiKey(格式)` 且
        `apiKey` 为空 → issue（create 无存量可依，纯 Zod 即可）
- [ ] 验证：`pnpm typecheck`

## Step 3 — 数据层

- [ ] `src/server/db/schema/provider.ts`：加 `providerApiFormat` pgEnum +
      `apiFormat` 列（notNull，default `openai-compatible`）
- [ ] `pnpm db:generate` → 生成 `0014_*.sql`，**人工确认 SQL 内容**符合预期
      （`CREATE TYPE` + `ADD COLUMN ... DEFAULT`）
- [ ] 若有本地库：`pnpm db:migrate` 验证能从当前状态干净升级
- [ ] 验证：`pnpm typecheck`；迁移文件纳入改动

## Step 4 — 服务层

- [ ] `src/server/services/provider.service.ts`：
      - `toOwnConfig` 的 `Pick` 与返回值加 `apiFormat`
      - `loadOwnConfig`、`listProviderConfigs` 两处 select 投影加 `apiFormat`
      - `createProviderConfig`：`.values()` 与 `.returning()` 加 `apiFormat`
      - `updateProviderConfig`：`patch` 类型加 `apiFormat?`，按 `!== undefined` 写入
      - `updateProviderConfig` **在 `requireOwnedConfig` 之后、构造 `patch` 之前**
        加 key 守卫（该行已被读出，不产生额外查询）：

        ```ts
        const targetFormat = input.apiFormat ?? existing.apiFormat;
        const incomingKey = typeof input.apiKey === "string" && input.apiKey.length > 0;
        const hasStoredKey = existing.encryptedApiKey !== null;
        if (requiresApiKey(targetFormat) && !incomingKey && !hasStoredKey) {
          throw new AppError("VALIDATION_FAILED", 400, "provider.apiKeyRequired");
        }
        ```
      - `discoverProviderModels`：调用改为传 `{ apiFormat, baseUrl, apiKey }`
- [ ] 新增 message key `provider.apiKeyRequired`：`messages/en.json` 与
      `messages/zh-CN.json` 的 `Errors.provider` 下（`en.json:466` 附近）。
      `AppErrorMessageKey` 从目录推导，不用改 `error-contract.ts`
- [ ] 确认 `src/app/api/providers/route.ts` 与 `[id]/route.ts` 无需改动
- [ ] 验证：`pnpm typecheck`

## Step 5 — provider 工厂

- [ ] 新建 `src/server/ai/provider-factory.ts`：`createLanguageModel(endpoint, modelId, options?)`
      按格式分派。openai-compatible 用 `.chatModel(modelId)`；
      **claude / google 用 `provider(modelId)`（两者没有 `.chatModel`）**
- [ ] `src/server/ai/chat-model.ts`：
      - `loadConfigRow` select 加 `apiFormat`
      - 用 `createLanguageModel` 替换硬编码的 `createOpenAICompatible`
      - 所有权闸门、解密、`describeError` 一行不动
- [ ] 验证：`pnpm typecheck` + 既有 `chat-model.test.ts`（会需要按新签名调整 mock）

## Step 6 — builtin 搜索按格式注入

- [ ] `src/server/ai/builtin-search.ts`：
      `withBuiltinWebSearch(format, base?)`；`FORMAT_INJECTION` 三分支；
      claude/google 走 `tools` **追加**语义
- [ ] URL 匹配前先 `toLowerCase()`：google 比 `generatecontent`
      —— 大小写敏感会漏掉 `:streamGenerateContent`，导致搜索静默失效
- [ ] `src/server/ai/builtin-search.test.ts`：既有用例补 format 参数，新增
      claude / google 注入与「不匹配则透传」用例；
      **google 用例必须覆盖 `:streamGenerateContent` 与 `:generateContent` 两种**
- [ ] 验证：`pnpm test -- builtin-search`

## Step 7 — Discover

- [ ] `src/server/ai/discovery.ts`：签名改为对象参数；按格式设置鉴权头与解析
      （google 剥 `models/` 前缀 + `supportedGenerationMethods` 过滤）
- [ ] `src/server/ai/discovery.test.ts`：既有调用点改为新签名；新增
      claude（`x-api-key` + `anthropic-version`）与 google（前缀剥离 + 过滤）用例
- [ ] 验证：`pnpm test -- discovery`

## Step 8 — 前端表单

- [ ] `src/components/provider/ProviderConfigForm.tsx`：
      - `useState<ProviderApiFormat>`（默认 `initial?.apiFormat ?? DEFAULT_PROVIDER_API_FORMAT`）
      - 加 `Select` 格式下拉（照 `ModelEditorDialog.tsx:379-412` 写法）
      - Base URL：placeholder 随格式变，去掉 `required`，提交时留空回落默认 baseUrl
      - API Key：`required={apiKeyRequired(format) && !isEdit}`
      - `initial` prop 类型加 `"apiFormat"`；提交对象加 `apiFormat`
- [ ] `src/components/provider/ProviderConfigsScreen.tsx`：
      - 创建 / 编辑两处 `initial` 补 `apiFormat`
      - `OwnProviderDetail` 的 baseUrl 行旁加格式 `SettingsBadge`
- [ ] `messages/en.json` + `messages/zh-CN.json` 的 `Provider` 命名空间加：
      `apiFormatLabel`、`apiFormatPlaceholder`、`formatOpenai`、`formatClaude`、`formatGoogle`
- [ ] 验证：`pnpm lint && pnpm typecheck`

## Step 9 — 测试补齐

- [ ] `src/server/ai/provider-factory.test.ts`（新）：
      三种格式分别构造出对应 provider 并传对 `baseURL`/`apiKey`；
      `builtinSearch` 为真时挂 `fetch`，否则不挂
- [ ] `src/server/services/provider.service.integration.test.ts`：
      create/patch 的 `apiFormat` 落库并回读；老行默认 `openai-compatible`
- [ ] 同上，key 守卫的四条用例：
      1. 有存量的 openai-compatible 切成 claude，**不传 key** → 成功（沿用存量 key）
      2. 无存量的配置切成 claude 且不传 key → 400，且库里格式未被改
      3. claude 配置显式 `apiKey: null` → 400（不允许清空）
      4. 切成 claude 同时传新 key → 成功并覆盖
- [ ] 可选：`ProviderConfigForm` 渲染测试（`src/test-utils/render-with-intl.tsx`
      已就绪），断言切换格式后 placeholder 变化

## Step 10 — 全量质量检查

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`（含 integration）
- [ ] 对照 `prd.md` Acceptance Criteria 逐条打勾
- [ ] 对照 `.trellis/spec/backend/index.md` 的 Quality Check 与
      `.trellis/spec/frontend/index.md` 的 Quality Check 各过一遍

## Step 11 — 规范更新与提交

- [ ] `.trellis/spec/backend/chat-search-tools.md`：
      - `withBuiltinWebSearch(base?)` → `withBuiltinWebSearch(format, base?)`
      - 补一段"按格式注入"的三种载荷与 URL 匹配规则
- [ ] `.trellis/spec/backend/provider-configs.md`：
      补 `apiFormat` 列、三种格式、Discover 按格式适配、`apiKey` 必填规则
- [ ] 前端 i18n 规范若要求新 key 登记，按 `.trellis/spec/frontend/i18n.md` 处理
- [ ] `git add` + `commit`（由用户确认提交信息；Trellis 不自动 commit）

---

## 风险提示

- Step 3 的迁移必须 `db:generate` 生成，不要手写。
- Step 4 的 key 守卫要在写库**之前**抛，别让非法状态落库。
- Step 6/7 改的是公共函数签名，先跑对应单测再动其他文件，避免雪崩式报错。

---

## 执行结果（2026-09-12）

Step 1–11 全部执行完毕，分支 `feat/provider-api-format`。与计划的偏差如下。

### 与计划不一致的地方

1. **API Key 校验两条路径都放在 service，create 没用 Zod `superRefine`。**
   判定口径是"写入后是否存在 key"，update 必须读存量行；放在一处才能让 create
   与 update 的错误 key 一致，也避免同一规则两处各写一遍后漂移。
2. **实现期被集成测试抓到一个真 bug（已修）。** 最初写成
   `incomingKey || existing.encryptedApiKey !== null`，于是 `apiKey: null`
   （显式清空）被误判成"沿用存量 key"，claude 配置的 key 能被清空却放行。
   改成 `keyPresentAfterPatch()` 显式建模"patch 之后的 key 状态"。
   这正是计划里 §3.2 想要的行为，第一版实现没写对。
3. **新增 `src/components/provider/provider-format-labels.ts`。**
   格式 → i18n label key 的映射要在表单和详情徽标两处用，抽出来避免重复。
4. **新增 i18n key 名与计划不同**：计划写 `apiKeyRequiredHint`（可选辅助说明），
   实际用 `apiKeyRequiredPlaceholder` —— 创建态 placeholder 必须是
   "该 API 格式必填"，否则和 `required` 自相矛盾。
5. **顺带修正 3 条既有文案**（本任务让它们变成不准确的陈述）：
   `Settings.Providers.description`、`Provider.emptyDescription`、
   `Provider.addProviderDescription` 里的 "OpenAI-compatible" 去掉。
6. **`provider.service.integration.test.ts` 加了本地 `createProviderConfig`
   包装**（默认 openai-compatible），避免改动 13 处既有调用点；
   格式相关的新用例直接调 `createProviderConfigRaw`。
7. **`withBuiltinWebSearch` 的 `FetchFunction` 类型改为导出**，
   供 `provider-factory.ts` 复用。
8. **Google 匹配器的大小写问题在计划阶段就查出来了**，实现按小写匹配
   `generatecontent`，并有用例覆盖 `:streamGenerateContent`。

### 未覆盖项（需要人工确认）

`ProviderConfigForm` 的格式下拉**交互**没有自动化测试：Base UI 的 Select
弹出层依赖真实 `PointerEvent`，jsdom 里没有，`pointerDown` 打不开 popup
（用键盘 `ArrowDown` 能打开列表，所以"三种选项都在"是可测的）。
因此**"用户点击下拉切换格式后 placeholder / 必填态随之变化"这一步需要浏览器
人工验收**。派生逻辑本身（三格式的 baseUrl 默认值、placeholder、必填态、
提交载荷）由 `provider-format.test.ts` + `ProviderConfigForm.test.tsx` 覆盖。

为一个测试去给共享的 `vitest.dom.setup.ts` 加 PointerEvent polyfill 不划算，
故记录在此而非偷偷扩大改动面。

### 验证

- `pnpm lint` — 通过，无 warning
- `pnpm typecheck` — 通过
- `pnpm test` — 88 → 90 文件全通过（新增 `provider-factory.test.ts`、
  `provider-format.test.ts`、`ProviderConfigForm.test.tsx`）

### 人工验收发现的缺陷（已修，2026-09-12）

用户在自托管网关 `http://192.168.99.224:3070/v1beta` 上建了 google 格式供应商
`hosted-gemini`，点 Discover 失败，但同样的 URL + key 用 curl 能成功。

排查：直接查库确认 `api_format='google'`、`base_url` 正确；再用真实凭据打真实端点，
拿到 **HTTP 200** 的响应体 —— `{ models: [ { name, ..., supportedGenerationMethods: null } ] }`。

**根因**：`googleModelsSchema` 里 `supportedGenerationMethods` 写的是
`.optional()`，只放过 `undefined`，**不放过 `null`**；网关对每个上游未设置的字段
都返回显式 `null`，于是整份 200 响应被判为 `provider.unexpectedResponse`。

修复：`.optional()` → `.nullish()`，`servesGenerateContent()` 把 `null` 与
"未声明"同等对待（保留该模型）。新增一条回归测试用 `null` payload。

用真实端点验证过：`fetchServedModelIds` 返回 34 个 id；
`nextPageToken` 为 `null`、`pageSize=1000` 仍 34 条，不存在分页截断。

教训已写进 `.trellis/spec/backend/provider-configs.md`：供应商响应 schema 里
可选的数值/数组字段一律用 `.nullish()`，不要用 `.optional()`。

### 过工程评审（ponytail-review）后的精简（2026-09-12）

五条全部验证成立并执行，净减 19 行：

| 位置 | 处理 | 行数 |
|---|---|---|
| `provider-factory.ts` | `EndpointContext` 打包对象 → 位置参数；`createLanguageModel` 的三元 spread → 一个 `const` | -5 |
| `provider.service.ts` | 单调用点的 `keyPresentAfterPatch()` 内联，规则改由注释承载 | -10 |
| `provider-format-labels.ts` | 删文件，3 项映射移入并导出自 `ProviderConfigForm.tsx`（Screen 本就 import 它） | -11 |
| `builtin-search.ts` | 只用一次且无注释的 `GOOGLE_SEARCH_TOOL` 常量内联 | -2 |
| `ProviderConfigForm.tsx` / `ProviderConfigsScreen.tsx` | 承接上面的映射与多行 import | +9 |

另外收窄三个没有外部使用者的 `export`：`ProviderEndpoint`、`DiscoveryOptions`、
`ProviderFormatDefaults`。

`pnpm lint` / `typecheck` / 645 个测试全过。

### trellis-check 核验后的收尾（2026-09-12）

核验结论 0 blocker / 0 warning，3 条 nit 全部处理：

1. **`discovery.ts` 的格式分派改成 `Record`**（`FORMAT_AUTH` / `FORMAT_PARSER`）。
   原本是 if/else + openai 兜底，而 `provider-configs.md` 声称"加一种格式三处都
   编译报错" —— 声明与代码不符。现在三处一致穷举：将来加第四种格式，discovery
   不会再静默继承 `Bearer` + `{data:[{id}]}` 的解析。（+~12 行，买的是"格式相关
   静默降级"这类 bug 的编译期防线 —— 本任务刚踩过一次。）
2. **删掉两条死文案**：`baseUrlPlaceholder`（placeholder 改由
   `PROVIDER_FORMAT_DEFAULTS` 供给后无人引用，值本身也是 URL 无需翻译）与
   `apiFormatPlaceholder`（`SelectValue` 始终有 children，占位文案永不可达）。
   同时去掉 `SelectValue` 上那个不可达的 `placeholder` prop。
3. **依赖改为精确锁定**（`4.0.52` / `4.0.67`，去掉 `^`），与 `ai@7.0.85`、
   `@ai-sdk/openai-compatible@3.0.41` 等同族依赖的风格一致。

提交时**不包含** `.trellis/tasks/09-12-provider-api-format-ext/`：本仓库只跟踪
`archive/` 下的任务目录（已用 `git ls-files` 确认）。
