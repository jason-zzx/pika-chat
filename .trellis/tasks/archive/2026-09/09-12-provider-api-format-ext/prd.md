# 扩充供应商 API 格式：支持 Claude 与 Google 端点

## Goal

当前"供应商(provider config)"硬编码只支持 OpenAI compatible 一种 API 格式：后端统一用
`createOpenAICompatible` 构造模型，Discover 统一打 `{baseUrl}/models` 并按 `{data:[{id}]}`
解析。本任务把它扩充为三种可选择的端点格式：

| 格式值 | 含义 | 默认 baseUrl |
|---|---|---|
| `openai-compatible` | OpenAI Chat Completions（现状，兼容各类中转） | `https://api.openai.com/v1` |
| `claude` | Anthropic Messages API (`/v1/messages`) | `https://api.anthropic.com/v1` |
| `google` | Google Gemini `generateContent` API | `https://generativelanguage.googleapis.com/v1beta` |

用户在创建 / 编辑供应商时**先选择格式**，再填写该格式对应的字段。

## Requirements

### R1 — 数据模型

- `provider_configs` 新增 `api_format` 列，枚举
  `('openai-compatible', 'claude', 'google')`，`NOT NULL`，默认
  `'openai-compatible'`。
- 已有行全部落到默认值，行为与今天完全一致（向后兼容，无需数据回填）。
- 迁移由 drizzle-kit 生成，与 schema 改动一起提交，且能从空库干净应用。

### R2 — 字段集（统一字段 + 格式默认）

三种格式共用同一套字段：**名称 / API 格式 / Base URL / API Key / 共享范围**。
格式只影响：

- `baseUrl` 的 placeholder 与留空时的默认值；
- `apiKey` 是否必填 —— `claude`、`google` 必填，`openai-compatible` 选填
  （本地无鉴权端点仍可用）。判定口径是「本次传入的 key」或「库里已存的 key」
  至少有一个：编辑时若该供应商已有 key，切换格式可直接沿用，不要求重填；
  两处都没有则拒绝保存，不让无 key 的 claude/google 配置入库；
- 后端按格式构造不同的 AI SDK provider。

不引入按格式分裂的额外字段（不做 anthropic-version / google apiVersion 输入框）。

### R3 — 创建与编辑表单

- 表单顶部新增格式下拉（复用 `components/ui/select.tsx`，与
  `ModelEditorDialog` 的用法一致），默认 `openai-compatible`。
- 编辑已有供应商时下拉回显该供应商已存格式。
- 切换格式实时更新 Base URL 的 placeholder，并按 R2 切换 API Key 的必填态。
- Base URL 留空时提交为该格式默认值；非空时按用户输入走 `z.url()` 校验。

### R4 — 后端按格式构造模型

- `openai-compatible` → `createOpenAICompatible`（保持现状，含 `includeUsage: true`）。
- `claude` → `createAnthropic`。
- `google` → `createGoogleGenerativeAI`。
- 新增 `@ai-sdk/anthropic@4`、`@ai-sdk/google@4` 依赖（与 `ai@7` /
  `@ai-sdk/provider@4` 同一代）。

### R5 — 内建联网搜索按格式适配

`withBuiltinWebSearch` 从"只注入 OpenAI 的 `web_search_options`"扩展为按格式注入：

- `openai-compatible`：`web_search_options: {}`（现状不变）
- `claude`：往 `/messages` 请求体 `tools` 追加
  `{ type: "web_search_20250305", name: "web_search", max_uses: 5 }`
- `google`：往 `:generateContent` 请求体 `tools` 追加 `{ googleSearch: {} }`

保持"best-effort"语义：URL/方法/请求体不匹配或解析失败时原样透传，绝不抛错。

### R6 — 模型发现（Discover）按格式适配

- `openai-compatible`：`GET {baseUrl}/models` + `Authorization: Bearer`，
  解析 `{data:[{id}]}`（现状不变）。
- `claude`：`GET {baseUrl}/models` + `x-api-key` 与
  `anthropic-version: 2023-06-01`，解析 `{data:[{id}]}`。
- `google`：`GET {baseUrl}/models` + `x-goog-api-key`，解析
  `{models:[{name}]}`，剥掉 `models/` 前缀；响应带
  `supportedGenerationMethods` 时只保留含 `generateContent` 的条目。

错误语义（超时 / 不可达 / 401-403 / 404 / 非预期响应）沿用现有
`provider.*` message key，不新增错误类型。

### R7 — 可见性

供应商详情区在 Base URL 旁展示格式标识，让"这个端点是什么格式"一眼可见。

## Constraints

- 不新增 react-hook-form 等依赖；表单沿用现有的原生 `<form>` + FormData 风格，
  仅为"按格式动态渲染"引入最小 `useState`。
- `src/lib/**` 不得 import `server-only`；格式常量与默认值放在共享层，前后端共用。
- 不在日志里落 API Key、请求体或响应体。
- 后端每个新字段仍需 Zod 校验；用户数据查询仍需带 owner 过滤。
- 新增能力必须经由 Route Handler 可达（本项目为未来移动端预留的硬约束）。

## Acceptance Criteria

- [ ] `provider_configs.api_format` 迁移生成并提交；空库 migrate 通过，既有行默认为 `openai-compatible`。
- [ ] `GET /api/providers` 返回的 own 配置带 `apiFormat`；shared 配置不变。
- [ ] `POST /api/providers` 可分别创建三种格式；`claude`/`google` 缺 apiKey 时 400。
- [ ] `PATCH /api/providers/{id}` 可改格式；不改时保持原值。
- [ ] 有存量 key 的供应商切成 claude/google 且不重填 key → 成功，沿用存量 key。
- [ ] 无存量 key 的供应商切成 claude/google 且不填 key → 400，且库里格式未被改写。
- [ ] 用 `claude` 格式的供应商发起聊天，请求打到 `{baseUrl}/messages`（单测断言 provider 类型与参数）。
- [ ] 用 `google` 格式的供应商发起聊天，请求走 Google 生成接口（单测断言 provider 类型与参数）。
- [ ] `openai-compatible` 的聊天行为与本任务前完全一致（含 `includeUsage`）。
- [ ] builtin 搜索：三种格式各自注入格式对应的搜索载荷；不匹配时透传。
- [ ] Discover：三种格式分别解析出正确的 model id 列表；google 结果已剥 `models/` 前缀。
- [ ] 创建/编辑表单出现格式下拉，切换后 Base URL placeholder 与 API Key 必填态随之变化。
- [ ] 供应商详情展示格式标识。
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿。

## Notes

- 已与用户确认的三个决策：统一字段集 + 格式默认值；Discover 按格式适配；
  builtin 搜索三种格式都适配（不是只对 OpenAI）。
- `withBuiltinWebSearch(base?)` 的签名会变（新增 format 参数），需同步更新
  `.trellis/spec/backend/chat-search-tools.md` 里的机制描述。
- `prd.md` 只写需求、约束与验收；技术设计见 `design.md`，执行清单见 `implement.md`。
