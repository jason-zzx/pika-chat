# 技术设计：附件管理页

## 1. 架构与边界

```
src/app/api/files/route.ts             + GET（列表，复用既有 POST 的路由文件）
src/server/files/file.service.ts       + listFilesForActor(actor, {offset, limit})
src/lib/schemas/file.ts                + fileListResponseSchema
src/lib/api/files.ts                   + listChatFiles / 复用 deleteChatFile
src/app/(app)/settings/files/page.tsx  新页面（RSC 壳 + client 组件）
src/components/settings/files/         新：FilesScreen / FilesList / FilePreviewDialog / UsageCard
src/components/layout/SettingsNav.tsx  + /settings/files tab
messages/*.json                        Settings.Files.* / settingsNav.files
```

依赖：子任务1（limits 端点、deleteFile 供应商联动）与子任务2（limits 响应的 usedBytes/quotaBytes）先行归档。

## 2. 列表端点

```ts
// file.service.ts
export async function listFilesForActor(
  actor: Actor,
  opts: { offset: number; limit: number; category?: FileListCategory },
  // limit clamp 1..100，默认 50
): Promise<{ files: ListedFile[]; totalCount: number; totalBytes: number }>

// src/lib/files/media-types.ts（isomorphic，服务端同用）
export type FileListCategory = "image" | "document" | "audio" | "video";
// document = pdf + office + ebook + text 并集；映射为 mediaType 集合做 IN 过滤
```

- category → mediaTypes 的映射在 media-types.ts 新增导出（单一事实源：分类表本来就在那里），服务端 where 加 `inArray(files.mediaType, types)`；非法值在路由层 zod 拒绝（400）。
- 单条 SQL：rows 子查询 + `count(*) over()` 窗口拿筛选后 totalCount，或两条查询并行（rows + 聚合）。totalBytes 的聚合查询**不带** category 过滤（用量口径恒定）。实现时择简。
- `referenced`：与 sweepOrphanFiles 相同的 `exists (select 1 from chat_messages cm where cm.parts @> jsonb_build_array(jsonb_build_object('url', '/api/files/' || files.id)))`——一期 sweep 已验证该 jsonb 谓词，直接复用其 SQL 片段。
- 响应经 zod schema（src/lib/schemas/file.ts）两端共享。

## 3. 页面结构

```
/settings/files (RSC page.tsx)
  └─ PageContainer max-w-3xl
      ├─ PageHeader
      ├─ UsageCard            totalBytes (+ quotaBytes 百分比，子任务2 字段存在时)
      └─ FilesScreen (client)
          ├─ CategoryFilter   全部/图片/文档/音频/视频（tab 式按钮组或 Select，
          │                    切换重置 offset 重新拉取；状态留在 client state，不入 URL）
          ├─ FilesList        行：类型 icon/badge、文件名、大小、时间、使用中 badge、操作
          ├─ 「加载更多」     offset 累加，hasMore = files.length < totalCount
          ├─ FilePreviewDialog 图片 <img src=/api/files/id>；其余类型行内「打开/下载」按钮
          └─ DeleteConfirmDialog
```

- 数据源：首屏 RSC 不预取（列表是私有的动态数据，client fetch 即可——与 AdminUsersScreen 模式一致）。
- 删除：未引用行 → 确认对话框 → `deleteChatFile`（既有 lib/api）→ 本地列表剔除 + 用量刷新；`referenced=true` 行删除按钮置灰 + tooltip/说明（**同时**容忍 409 竞态：点击时已被引用 → apiErrorMessageFromUnknown 解析 toast，memory #55）。
- 预览：mediaType 分类复用 src/lib/files/media-types.ts 的 classifyFile；image → 对话框内 `<img>`（经认证同源 GET，直接作 src 可行——same-origin cookie）；audio/video/pdf/其他 → 新标签页打开 /api/files/[id]（inline disposition 已由后端控制）。
- 操作入口：行尾按钮（预览 / 下载 / 删除），**不使用 hover-reveal**（memory #15）；窄屏下行内按钮压缩为 icon，仍为常驻可见。

## 4. 用量区块

- 数据源：`GET /api/files/limits`（子任务1）——含 usedBytes/quotaBytes（子任务2 后）；加上列表端点的 totalBytes 冗余时以 limits 为准，列表端点 totalBytes 仅作列表内部统计展示回退。实现时统一：**用量区块只调 limits 端点**。
- 展示：`已用 X / Y`（quotaBytes null → 仅 `已用 X`）；配额百分比 >90% 时 SettingsBadge 警示色（仅 --success 之外的语义色如有既有 token 则用，无则纯文本百分比，不新造 token——memory #42 只约束状态点用 --success）。
- 删除成功后重新拉取 limits。

## 5. 导航与 i18n

- SettingsNav.tsx SETTINGS_TABS 插入 `{ href: "/settings/files", labelKey: "settingsNav.files" }`（account 之后、providers 之前），SettingsTabLabelKey 联合类型同步；SettingsNav.test.tsx 补断言。
- i18n：`settingsNav.files`、`Settings.Files.*`（title/usage/empty/inUse/preview/download/delete/confirm…），中英文两份 messages 同步；JSX 事件处理器内字面量提升模块常量（memory #45）。

## 6. 关键取舍记录

1. **受限宽度（max-w-3xl）而非 master-detail**：文件列表是单实体扁平列表，无双栏详情语义（memory #43 的 master-detail 适用于 providers 那种编辑型列表）；删除确认走对话框。
2. **列表仅本人、无管理员视图**：管理员的存储治理手段是配额（子任务2），不是翻看用户文件内容——隐私边界顺便收紧。
3. **粗分类靠 mediaType IN 过滤而非 DB 加列**：分类是纯展示维度，media-types.ts 的分类表就是事实源；加列意味着写入路径同步与回填，为一个筛选器不值。五个粗类（全部/图片/文档/音频/视频）是拍板口径，「文档」合并 pdf/office/ebook/text。
4. **偏移分页 + 加载更多**：附件量级（百级）不需要 cursor/虚拟滚动；`referenced` EXISTS 子查询在百级行数下成本可忽略。筛选切换重置 offset。
5. **删除置灰 + 409 双保险**：置灰是 UX，409 是真相（列表加载后引用状态可能变化）。
6. **预览只做图片对话框**：PDF/音视频交给浏览器新标签页原生能力（inline disposition 已就绪），不自建预览器。
7. **client fetch 而非 RSC 预取**：与 AdminUsersScreen 一致；私有动态数据无 SSR 收益。

## 7. 测试策略

- listFilesForActor 集成测试：分页边界、归属隔离、referenced 判定、totalBytes（不随筛选）、四分类过滤与并集正确性。
- GET /api/files 端点测试：未认证 401、limit clamp。
- 组件测试：FilesList 渲染（含 sizeBytes=0 的 pending 行）、删除流程（确认→成功剔除 / 409 toast）、空态。
- SettingsNav 测试更新。
- 手测：桌面 + 移动视口 tap 路径、图片预览、PDF 新标签、删除后用量刷新。

## 8. 追加设计（2026-09-14，用户拍板）

### 8.1 批量选择/删除

```
FilesScreen
  └─ FilesList
      ├─ 表头行：全选 checkbox（indeterminate 态）——只选「未引用且已加载」的行
      ├─ 行首 checkbox（referenced 行 disabled + aria-describedby 指向 in-use badge）
      └─ 选中 > 0 时浮出批量工具条：已选 N 项 · [删除] [取消]
```

- 选择集 `Set<fileId>` 留在 FilesScreen state；category 变化（query key 变化）、批量删除完成、手动取消时清空。
- 删除：确认对话框（列数量；有 referenced 混入时提示「使用中将被跳过」——实际上 referenced 不可选，所以对话框文案为「将删除 N 个文件」）→ `Promise.allSettled(ids.map(deleteChatFile))` → 汇总：成功 X、409 跳过 Y（竞态兜底：加载后被引用）→ invalidate `fileKeys.all` 一次（列表 + 用量同刷）→ 清空选择集；跳过的行经重取自然回到列表并带 in-use 态。
- 不新增后端接口：DELETE /api/files/[id] 语义逐个成立（供应商联动删除、409、归属校验全部复用），附件量级（百级）下客户端并发足够。
- 全选语义 = 当前已加载页中所有未引用行（不含 referenced、不含后续「加载更多」的行——避免看不见的选中）。

### 8.2 storageKey 带扩展名

- 布局从 `<userId>/<fileId>` 变为 `<userId>/<fileId>.<ext>`。扩展名提取复用 `media-types.ts` 的 `fileExtension()`，再过 `[a-z0-9]` 过滤 + 长度封顶（≤10），无扩展名则不拼接。
- 单点 helper（如 `storageKeyFor(userId, fileId, filename)`）放 `file.service.ts` 或 media-types 旁，`uploadFile`/`presignFile` 共用——两处现有调用点必须收敛到同一 helper，不许各写一份。
- ext 只影响对象 key 的可读性：响应/下载一切照旧由行内 `media_type` 决定；`assertValidStorageKey` 的段守卫不变（`01a….png` 是合法段）。
- 存量行零迁移：读路径永远以行内 `storage_key` 为准。

### 8.3 集成测试存储 hermetic 化

- 根因：`file.service.integration.test.ts`（0 处 vi.mock）与 `quota.integration.test.ts` 通过真实 `getFileStorage()` 向真实 S3 桶写 fixture——测试隔离了 TEST_DATABASE_URL 却没有隔离对象存储，桶内残留数百测试对象。
- 修法：共享的 in-memory `FileStorage` 假实现（Map<string, Buffer>，put/get/delete 齐全 + `recordedKeys` 供断言），经集成测试公共 setup 对 `@/server/files/storage` 做 `vi.mock`（与 `file.service.direct.integration.test.ts` 既有手法一致，提取为共享 helper 而非第三份拷贝）。
- 泄漏不变量：集成 setup 的 `afterEach` 断言假存储为空——任何 put 未被对应 delete 回收即测试失败，把昨天的桶污染变成不可能复发的测试失败。
- byte round-trip 等用例经假存储同样成立（测的是 service 编排，不是 S3 本身；S3 行为已由手测与 storage.test.ts 覆盖）。

## 9. 回滚

- 纯增量（新页面 + 新端点 + 导航一项）；回滚 = revert，无 schema 变更。
