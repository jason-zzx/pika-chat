# 用户级默认模型设置 — 执行计划

> 验证命令:`pnpm lint` · `pnpm typecheck` · `pnpm test`(单文件 `pnpm vitest run <file>`)
> 迁移:`pnpm db:generate` 生成迁移文件(用户自行 `pnpm db:migrate` 应用)

## Checklist

1. [ ] **DB schema + 迁移**:`users` 加 `model_preferences` jsonb nullable 列(`src/server/db/schema/auth.ts`);`pnpm db:generate`。
2. [ ] **共享 schema**:`src/lib/schemas/model-preferences.ts`(pair/四槽位/purpose 类型 + 响应 schema)。
3. [ ] **model-preferences.service.ts**:`getModelPreferences`(容错解析)、`updateModelPreferences`(available 校验 + 整体替换)、`resolveModelPreference`(失效静默 null);单元测试 + 集成测试(参照 user-preferences.service 两个测试文件)。
4. [ ] **API 路由**:`GET/PATCH /api/account/model-preferences`;路由测试(400 不可用模型、ownership、双方法)。
5. [ ] **标题接入**:`generateTopicTitleSchema` pair 可选;`title.service.ts` 偏好优先、无 pair 走文本兜底;补服务测试。
6. [ ] **翻译接入**:`translateMessageRequestSchema` pair 可选;`translation.service.ts` 偏好优先、皆无 400;补服务测试。
7. [ ] **手动压缩接入**:compress schema pair 可选;路由偏好优先;集成测试补偏好覆盖用例。
8. [ ] **自动压缩接入**:chat 路由与 regenerate 路由注入 compression 偏好 handle(阈值仍按会话模型);两条路由的测试各补偏好覆盖用例;更新 `require-model.ts` 注释。
9. [ ] **前端解析链**:`resolveComposerModel` 加 `userDefaultPair` 第三级;ChatView 接 `useModelPreferences`;单测更新。
10. [ ] **useModelPreferences hook**:GET 查询 + PATCH mutation(invalidate/setQueryData)。
11. [ ] **新建助手预填**:AssistantEditorDialog 创建模式预填 chat 偏好;组件测试。
12. [ ] **设置页**:`settings/models/page.tsx` + `ModelPreferencesScreen`(四行 ModelPicker + allowClear 单项重置 + 「全部重置」按钮、改即存、错误提示);SettingsNav 加 tab + 联合类型;组件/导航测试更新。
13. [ ] **i18n**:`Layout.settingsNav.models`、`Settings.Models.*`、必要时 `Errors.actions.*` 中英文案。
14. [ ] **全量验证**:lint + typecheck + test 全绿。
15. [ ] **Spec 更新**(Phase 3.3):compression/translation spec 语义修订,新增 model-preferences spec。

## 回滚点

- 步骤 4 之后:纯新增 API,无行为变化,可安全独立提交。
- 步骤 8 之后:服务端偏好全部生效但无 UI,只能通过 API 设置;可作为中间态。
- 任何一步出问题:schema 的 pair 均为可选,回退即恢复现状;DB 列 nullable,回滚代码无需回滚迁移。

## 评审 Gate

- 步骤 4 后:API 契约(请求/响应 schema、错误矩阵)评审一次再继续接入。
- 步骤 14:全量 check 后进入 Phase 3。
