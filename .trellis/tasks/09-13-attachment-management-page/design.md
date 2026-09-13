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

## 8. 回滚

- 纯增量（新页面 + 新端点 + 导航一项）；回滚 = revert，无 schema 变更。
