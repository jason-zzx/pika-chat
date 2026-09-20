# 用户级默认模型设置（聊天/标题/压缩/翻译）

## Goal

在设置中新增独立的「默认模型」页，让用户为四个用途分别配置默认模型：默认聊天模型、标题生成模型、压缩上下文模型、翻译模型。显式设置的偏好无条件优先生效；偏好模型失效（供应商/模型被删）时静默回退到现有行为，不报错。

## Confirmed Facts（代码勘察）

- 现状四处模型来源各不相同：标题生成用首条消息的模型（`title.service.ts`，前端传 pair）；翻译用消息/当前模型（`translation.service.ts`，前端传 pair）；手动压缩用 composer 当前模型，自动压缩硬绑定会话自身模型（`compression.service.ts` + chat/regenerate 路由，`requireModelForActor` 单点门校验）；聊天模型解析链为「话题上一条消息模型 → 助手默认模型 → null」（`resolve-composer-model.ts`）。
- 用户级偏好已有落库范式：`users.theme_mode/theme_preset` + `user-preferences.service.ts` + `PATCH /api/account/preferences`（zod 边界校验、读出时再解析容错）。
- 助手默认模型校验已有范式：`assistant.service.ts` 的 `assertModelAvailable`（对 `resolveAvailableModels` 结果做存在性校验，失败抛 `model.notAvailable`）。
- 前端模型选择器可直接复用：`components/chat/ModelPicker.tsx`（支持 `allowClear`）+ `useAvailableModels`；助手编辑对话框的「失效模型提示」模式可复用到预填逻辑。
- 设置导航为静态数组：`SettingsNav.tsx` 的 `SETTINGS_TABS`，新增 tab 需同步 `SettingsTabLabelKey` 联合类型、`Layout.settingsNav.*` 双语文案、`SettingsNav.test.tsx`。
- 自动压缩在 chat 与 regenerate 两条流式路由内联触发，摘要用的是会话 handle；阈值判断用会话模型的 `contextTokens`（裁剪决策属于会话模型，不随压缩偏好改变）。

## Requirements

- R1 **存储**：`users` 表新增 `model_preferences` jsonb 列（nullable），存放四个槽位 `{chat?, title?, compression?, translation?}`，每槽位为 `{providerConfigId, modelId}` 或缺省/清除。读出时 zod 再解析，脏数据降级为空偏好（参照 theme 解析模式）。
- R2 **API**：新增 `GET /api/account/model-preferences` 与 `PATCH /api/account/model-preferences`。PATCH 整体替换四槽位，保存时逐对校验可用性（`resolveAvailableModels`），不可用则 400 `model.notAvailable`；槽位传 null 表示清除。
- R3 **服务端解析助手**：`resolveModelPreference(actor, purpose)` 返回仍可用的偏好 pair，未设置或已失效返回 null（静默回退，不抛错）。
- R4 **标题生成**：`/api/topics/[id]/title` 请求体的 model pair 改为可选；服务端优先用 `title` 偏好，缺省用客户端传的 pair（现有行为）；两者皆无则跳过生成走截断文本兜底。
- R5 **翻译**：`/api/translate` 请求体 pair 改为可选；优先 `translation` 偏好 → 客户端 pair；皆无则 400 `model.notAvailable`。
- R6 **压缩（手动+自动）**:`compression` 偏好对手动端点与自动压缩（chat + regenerate 路由）同时生效，覆盖「摘要模型=会话模型」的旧语义；缺省回退会话模型。阈值判断仍用会话模型的 `contextTokens` 不变。
- R7 **默认聊天模型**：聊天模型解析链变为「话题上一条消息模型 → 助手默认模型 → 用户默认聊天模型 → null」；助手默认模型失效时跳过它落到用户默认。新建助手对话框的默认模型字段预填 `chat` 偏好（可用时）。
- R8 **设置 UI**：新增独立设置页 `/settings/models`（不进通用页），四个模型选择器（复用 `ModelPicker`，`allowClear` 支持单项重置），改即存（参照 ThemeControl 模式）；页面提供「全部重置」按钮，一键清除四个槽位；设置导航新增「默认模型」tab，中英双语文案。
- R9 **权限与隔离**：偏好为用户级，所有读写限定当前 actor；无实例级默认（明确不做）。

## Acceptance Criteria

- [ ] AC1：设置导航出现「默认模型」入口，页面含四个槽位的模型选择器，可设置、可更换、可单个清除（重置）；「全部重置」一次清除四个槽位；中英双语。
- [ ] AC2：设置 `title` 偏好后，新话题标题生成使用偏好模型；清除后恢复用首条消息的模型。
- [ ] AC3：设置 `translation` 偏好后，消息翻译使用偏好模型；清除后恢复现有行为。
- [ ] AC4：设置 `compression` 偏好后，手动压缩与自动压缩（超 80% 阈值触发）都使用偏好模型生成摘要；清除后恢复会话模型。
- [ ] AC5：设置 `chat` 偏好后：无话题历史且助手无默认模型时，composer 选中用户默认聊天模型；助手默认模型被删（失效）时落到用户默认聊天模型；话题已有消息时仍以话题上一条消息模型优先。
- [ ] AC6：新建助手对话框的默认模型字段预填 `chat` 偏好（偏好可用时）。
- [ ] AC7：偏好模型被删除/不可用后，对应场景静默回退到现有行为，不报错、不阻塞操作。
- [ ] AC8：PATCH 保存时校验可用性，提交不可用模型返回 400；偏好读取接口只返回当前用户自己的偏好。
- [ ] AC9：刷新页面/换设备后偏好仍生效（服务端落库）。
- [ ] AC10：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿。

## Out of Scope

- 实例级（管理员）默认模型。
- 按助手/按话题覆盖标题/压缩/翻译模型。
- 压缩阈值、摘要 prompt 等压缩行为本身的调整。
- 推理强度（reasoning effort）的默认设置。
