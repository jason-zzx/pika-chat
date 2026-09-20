# 用户级默认模型设置 — 技术设计

## 架构与边界

```
设置页 /settings/models (新)                     聊天场景
  └─ ModelPreferencesScreen (client)             ChatView
       └─ GET/PATCH /api/account/model-preferences (新)
            └─ model-preferences.service.ts (新) ── users.model_preferences (jsonb)
                     │ resolveModelPreference(actor, purpose)
        ┌────────────┼────────────────┬──────────────────┐
   title 路由     translate 路由    compress 路由      resolve-composer-model.ts
   (pair 可选)    (pair 可选)      (手动 pair 可选;    (链尾加 userDefault 一级,
                                    自动注入偏好 handle)   数据来自 useModelPreferences)
```

## 数据层

- `src/server/db/schema/auth.ts`:`users` 增加
  `modelPreferences: jsonb("model_preferences")`（nullable，无默认值；null = 无偏好）。
  迁移由 `pnpm db:generate` 生成（schema 文件不 import `server-only`,spec 已记录）。
- 共享 zod schema `src/lib/schemas/model-preferences.ts`:

```ts
const modelPairSchema = z.object({ providerConfigId: z.string().min(1), modelId: z.string().min(1) });
export const modelPreferencesSchema = z.object({
  chat: modelPairSchema.nullish(),
  title: modelPairSchema.nullish(),
  compression: modelPairSchema.nullish(),
  translation: modelPairSchema.nullish(),
});
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>;
export type ModelPreferencePurpose = keyof ModelPreferences;
```

  读 DB 时 `modelPreferencesSchema.catch({})` 式容错解析（脏数据 → 空偏好，参照 theme 的 parse 模式）。

## 服务端

### model-preferences.service.ts（新）

```ts
getModelPreferences(userId): Promise<ModelPreferences>            // 读列 + 容错解析
updateModelPreferences(input, actor): Promise<ModelPreferences>   // 逐对 resolveAvailableModels 校验,
                                                                  // 不可用 → 400 model.notAvailable;整体替换写回
resolveModelPreference(actor, purpose): Promise<ModelPair | null> // 偏好存在且仍在 available 列表 → pair,否则 null
```

`resolveModelPreference` 内部一次 `resolveAvailableModels(actor)` 做存在性过滤——失效即 null,调用方走自己的回退路径,全程不抛错。

### API 路由

`src/app/api/account/model-preferences/route.ts`:`GET` / `PATCH`,`requireActor` + zod 边界 + `withErrorHandling`,与 `account/preferences/route.ts` 同构。

### 各场景接入

- **标题**(`title.service.ts`):入参 pair 变可选;`pair = await resolveModelPreference(actor, "title") ?? input.pair`;仍无 pair 时跳过 `generateText`,直接 `fallbackTitleFromMessage`。路由 schema(`lib/schemas/topic.ts` 的 `generateTopicTitleSchema`)pair 字段改 `.optional()`;ChatView 继续传 pair 作为回退,无需改调用。
- **翻译**(`translation.service.ts`):同上,`resolveModelPreference(actor, "translation") ?? input pair`;皆无 → `model.notAvailable` 400。schema 同步改可选。
- **手动压缩**(`/api/topics/[id]/compress`):pair 可选;`resolveModelPreference(actor, "compression") ?? body pair`,皆无 → 400。
- **自动压缩**(chat 路由 + regenerate 路由):当前把会话 handle 传给 `compressTopicHistory`。改为:先 `resolveModelPreference(actor, "compression")`,有则用 `requireModelForActor(pair, actor)` 另建 handle 传给压缩,无则用会话 handle。**阈值判断仍用会话模型的 `contextTokens`**(裁剪决策属于会话模型);只有摘要生成换模型。压缩失败非致命语义不变。
- **require-model.ts 注释**:「summary model is the session's own model」表述更新为偏好优先语义(spec 同步)。

## 前端

### 聊天模型解析(`resolve-composer-model.ts`)

输入增加 `userDefaultPair: ComposerModelPick | null`,链变为
`topicLastAssistantPair → assistantDefaultPair → userDefaultPair → null`,每一级都做现有的 available 存在性检查(失效自动下落,天然满足「助手模型失效 → 用户默认」)。ChatView 通过新 hook `useModelPreferences()`(TanStack Query,`chatKeys` 旁新增 key)取 `chat` 槽位传入。

### 新建助手预填

`AssistantEditorDialog` 创建模式(非编辑)下,默认模型字段的初值取 `useModelPreferences` 的 `chat` 槽位(经 available 过滤);沿用现有 staleModel 提示模式。编辑模式不变(以助手自身存储值为准)。

### 设置页

- `src/app/(app)/settings/models/page.tsx`:server component,auth 守卫 + `getTranslations`,渲染 client 的 `ModelPreferencesScreen`(参照 SearchProvidersScreen 的 page/screen 分层)。
- `src/components/settings/models/ModelPreferencesScreen.tsx`：四个 `SettingsRow`（默认聊天/标题生成/压缩上下文/翻译），每行一个 `ModelPicker`（`allowClear`，清除即单项重置）；底部「全部重置」按钮（四槽位全置 null 提交，二次确认不必需——操作可逐项恢复）。改即存——`useMutation` 调 PATCH，整体提交当前四槽位；失败 toast/行内错误用 `apiErrorMessage` + `Errors.actions.*` 模式。每行描述文案说明回退行为。
- `SettingsNav.tsx`:加 `{ href: "/settings/models", labelKey: "settingsNav.models" }`(位置:general 之后),扩 `SettingsTabLabelKey` 联合;`messages/en.json` / `zh-CN.json` 加 `Layout.settingsNav.models` 与 `Settings.Models.*` 文案。
- 偏好数据:screen 内 `useModelPreferences()` 读 GET;PATCH 成功后 `setQueryData`/invalidate。无需 SSR 注入(非首屏关键,参照 providers/search 页的 client fetch 模式)。

## 兼容与回退矩阵

| 场景 | 偏好可用 | 偏好缺失/失效 |
|---|---|---|
| 标题 | 偏好模型 | 请求体 pair → 截断文本 |
| 翻译 | 偏好模型 | 请求体 pair → 400 notAvailable |
| 手动压缩 | 偏好模型 | 请求体 pair |
| 自动压缩 | 偏好模型(阈值仍按会话模型) | 会话 handle |
| 聊天选模型 | 解析链第三级 | 现有两级链 |
| 新建助手预填 | `chat` 槽位 | 不预填(现状) |

## 关键取舍

- **jsonb 单列 vs 8 列**:四槽位同构、整体读写、未来加槽位免迁移,选 jsonb;代价是 DB 层无约束,由 zod 读写双端兜底。
- **使用时静默回退 vs 报错**:偏好模型失效属正常生命周期(供应商可删),报错会阻塞无关操作,选静默回退;可用性只在保存时强校验。
- **新 API 路由 vs 扩展 account/preferences**:主题与模型是两个关注点、请求方不同,单开路由;users 表同列存放是因为二者都是「用户偏好」这一聚合。
- **自动压缩换模型但不换阈值基准**:摘要模型的 context window 与会话模型可能不同,但「何时压缩」由会话模型能不能装下历史决定,与摘要模型无关。

## Spec 更新点(Phase 3.3)

- `backend/chat-history-compression.md`:摘要模型语义改为「compression 偏好 ?? 会话模型」,require-model 章节同步。
- `backend/chat-message-translation.md`:翻译模型来源改为偏好优先。
- 新增 `backend/model-preferences.md`(或并入 provider-configs):四槽位、解析与静默回退契约。
- `frontend/` 侧:SettingsNav tab 列表如有记录则同步。
