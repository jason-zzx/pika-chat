# 执行计划：附件管理页

前置条件：子任务1（upload-pipeline）、子任务2（quota）已归档。

## Step 1：列表端点

- [ ] media-types.ts：FileListCategory 类型 + category→mediaTypes 映射（document = pdf/office/ebook/text 并集）
- [ ] file.service.ts：listFilesForActor（分页 + category 过滤 + referenced EXISTS 复用 sweep 谓词 + totalBytes 全量）
- [ ] src/lib/schemas/file.ts：fileListResponseSchema
- [ ] GET /api/files（挂在既有 route.ts，401/归属/clamp/category zod 校验）
- [ ] 集成测试（含四分类过滤与并集）+ 端点测试
- 验证：`pnpm vitest run src/server/files src/app/api/files`

## Step 2：页面骨架与导航

- [ ] SettingsNav 注册 /settings/files + 测试更新 + i18n settingsNav.files
- [ ] settings/files/page.tsx（RSC 壳）+ components/settings/files/ 目录
- [ ] UsageCard（limits 端点；quotaBytes 可空）
- 验证：`pnpm tsc --noEmit` + `pnpm lint`

## Step 3：列表与操作

- [ ] FilesScreen / FilesList（加载更多、空态、使用中 badge、pending 行容忍）
- [ ] CategoryFilter（全部/图片/文档/音频/视频，切换重置分页）
- [ ] FilePreviewDialog（图片）；打开/下载按钮（新标签页）
- [ ] 删除：确认对话框 → deleteChatFile → 刷新列表与用量；referenced 置灰 + 409 toast 兜底
- [ ] lib/api/files.ts：listChatFiles
- [ ] 组件测试
- 验证：`pnpm vitest run` 相关 + `pnpm tsc --noEmit` + `pnpm lint`

## Step 3b：批量选择（R5）

- [x] FilesList 行首 checkbox + 表头全选（未引用行；indeterminate 态）
- [x] 批量工具条（已选 N · 删除/取消）+ 确认对话框 + Promise.allSettled 逐条删除 + 结果汇总
- [x] 选择集生命周期（切分类/完成/取消清空）
- [x] 组件测试：全选/单选/混合 409 汇总/工具条显隐
- 验证：`pnpm vitest run src/components/settings/files`

## Step 3c：storageKey 扩展名（R6）

- [x] `storageKeyFor(userId, fileId, filename)` 单点 helper（ext 过滤 `[a-z0-9]`、≤10、空则无点）
- [x] `uploadFile` / `presignFile` 收敛到该 helper
- [x] 单测：各扩展名形态（正常/大写/特殊字符/无扩展/超长）
- 验证：`pnpm vitest run src/server/files`

## Step 3d：集成测试存储 hermetic 化（R7）

- [x] 共享 in-memory FileStorage 假 + 集成 setup vi.mock（与 direct 测试同手法）
- [x] afterEach 泄漏断言（假存储必须为空）
- [x] 修正受影响的集成测试
- 验证：`pnpm vitest run`（全量）+ 跑完后真实桶对象数不增

## Step 4：全量 gate

- [ ] `pnpm vitest run` 全量 + `pnpm tsc --noEmit` + `pnpm lint`
- [ ] 手测矩阵：桌面/移动 tap、图片预览、PDF 打开、删除与 409、用量刷新、他人文件不可达
- [ ] 对照 PRD Acceptance Criteria 逐条勾验

## 检查点（dispatch 前）

- [ ] prd.md / design.md / implement.md 已评审
- [ ] implement.jsonl / check.jsonl 已策展真实 spec 条目
- [ ] task.py validate 通过
