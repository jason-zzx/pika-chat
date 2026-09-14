# 附件管理页：/settings/files 列表、预览、删除与用量展示

父任务：.trellis/tasks/09-13-chat-attachments-phase3（本任务 = A，管理页形态已拍板为新建设置页 /settings/files）

## Goal

给用户一个集中管理自己附件的设置页：查看列表、预览/下载、删除未引用附件、查看存储用量。

## Background / Confirmed Facts

代码现状（2026-09-13 核实）：

- 已有端点：`GET /api/files/[id]`（下载/预览，inline disposition 已支持 image/audio/video/PDF）、`DELETE /api/files/[id]`（被引用时 409）。**缺列表端点**。
- `GET /api/files/limits`（子任务1）响应含 `maxFileBytes / directUpload`，子任务2 落地后扩展 `usedBytes / quotaBytes`。
- 设置导航：`src/components/layout/SettingsNav.tsx` SETTINGS_TABS 注册（staffOnly 模式有先例）；设置页宽度由各页 PageContainer 自决（memory #46）；共享原语 SettingsCard/SettingsSection/SettingsRow/SettingsBadge（memory #42）。
- 删除语义：`deleteFile` 对被消息引用的文件 409 file.inUse——管理页删除被引用文件时展示该错误即可。
- 子任务1 的 presign pending 行（sizeBytes=0）会在列表中出现，最长存活 24h：列表需容忍（显示为「处理中」或直接展示 0 B）。
- 移动端约束（memory #15）：无 hover-only 交互；clipboard 非安全上下文降级（memory #13）本页不涉及复制则无关。

## Requirements

### R1 列表端点

- `GET /api/files`（认证，本人文件）：`?offset=&limit=`（默认 limit 50，上限 100）+ `?category=` 筛选（见 R2），按 createdAt 倒序，返回 `{ files: [{ id, filename, mediaType, sizeBytes, extractionStatus, createdAt, referenced }], totalCount, totalBytes }`。
- `totalCount` / `totalBytes`：totalCount 随 category 筛选（「本类共 N 个」）；totalBytes 恒为全量用量（与用量区块口径一致，不随筛选变化）。
- `referenced` 由与 sweepOrphanFiles 同形的 EXISTS 子查询计算（消息 parts jsonb 含引用），供 UI 标注「使用中」。
- 归属严格限定 actor 本人，无管理员越权视图（管理员要管存储靠配额，不看内容）。

### R2 分类筛选

- 粗分类（2026-09-13 拍板）：**全部 / 图片 / 文档 / 音频 / 视频**——复用 src/lib/files/media-types.ts 的 isomorphic 分类表，「文档」= pdf + office + ebook + text 的并集。
- 服务端：category 参数映射为 mediaType 集合做 `IN` 过滤（分类表在 src/lib 下，服务端可直接引用，无需 DB 加列）；非法 category 值 400。
- 前端：列表上方筛选控件（tab 式按钮组或 Select，实现时按设置页视觉一致性择一），切换即重置分页重新拉取；当前筛选体现在空态文案中（「该分类下暂无附件」）。

### R3 /settings/files 页面

- SettingsNav 注册新 tab（所有用户可见，非 staffOnly）。
- 页面结构（PageContainer max-w-3xl 受限宽度即可，非 master-detail）：
  1. **用量区块**：`totalBytes`（子任务2 落地后：用量/配额 + 百分比，SettingsBadge 点缀）。
  2. **文件列表**：文件名、类型 badge（image/document/audio/video）、大小、上传时间、使用中 badge；空态文案。
  3. **操作**：预览/下载（GET /api/files/[id]，图片对话框内预览，其余新标签页打开）、删除（未引用 → 确认对话框 → DELETE；被引用 → 禁用并说明或 409 错误 toast）。
- 分页：偏移分页「加载更多」即可（附件量级小，不做虚拟滚动）。
- 移动端 tap 路径完整（memory #15）；对话框用 base-ui Dialog 既有原语。

### R4 删除联动

- 管理页删除复用既有 `DELETE /api/files/[id]`，不做新语义；子任务1 落地的供应商侧联动删除在其内自动生效。

### R5 批量选择（2026-09-14 追加，用户拍板）

- 列表行首 checkbox（`ui/checkbox.tsx` 原语）+ 表头全选（选中当前已加载的全部**未引用**行）。
- 选中态出现批量工具条：「已选 N 项 · 删除 / 取消」；`referenced: true` 行的 checkbox 禁用（与行内删除按钮同口径，禁用原因可见）。
- 批量删除：确认对话框（含数量与「使用中将被跳过」提示）→ 客户端逐条 `deleteChatFile`（`Promise.allSettled`，复用既有端点，**不新增后端批量接口**）→ 结果汇总「已删除 X，跳过 Y（使用中）」，跳过行刷新为 referenced 并重置其选择态。
- 选择集为 client state（`Set<fileId>`），切分类/删除成功/列表刷新时清空；「加载更多」后的新行不自动入选。
- 移动端 tap 路径完整（memory #15），无 hover-only 交互。

### R6 存储 key 带文件后缀（2026-09-14 追加，用户拍板）

- storageKey 从 `<userId>/<fileId>` 改为 `<userId>/<fileId>.<ext>`，ext 取自原始文件名的扩展名（小写、`[a-z0-9]` 过滤、长度封顶；无扩展名则不加点）——便于在 S3/RustFS 控制台直接辨认与管理对象。
- 改动点为 `uploadFile` 与 `presignFile` 两处创建路径（`completeFile` 读行内已有 storageKey，不动）；既有行不变（storage_key 列即真相，无迁移）。
- 扩展名仅作可辨识性用途：下载/预览的 Content-Type 仍来自行的 media_type 列（不信任 key 后缀）；`assertValidStorageKey` 守卫保持不变（`fileId.ext` 不构成 `.`/`..` 段）。

### R7 集成测试存储隔离（2026-09-14 追加，测试污染修复）

- 现状：`file.service.integration.test.ts`（0 处 mock）与 `quota.integration.test.ts` 经 `getFileStorage()` 写入**真实 S3 桶**（测试只隔离了 TEST_DATABASE_URL，没隔离对象存储），已在用户桶内留下数百个测试 fixture 对象。
- 要求：所有集成测试的存储必须 hermetic——共享的 in-memory 假 FileStorage（挂 vi.mock，与 direct 集成测试同法）或 env 作用域的隔离桶/临时本地目录；集成 setup 的 afterEach 断言假存储为空（每个 put 都有对应 delete 回收），把「泄漏」变成测试不变量。
- 验收：全量测试跑完后真实桶对象数不增加（用户确认桶内残留清理后）。

## Acceptance Criteria

- [ ] /settings/files 出现在设置导航且所有登录用户可访问；未登录跳转登录（settings layout 既有行为）。
- [ ] 列表展示本人全部附件（分页加载），字段完整；空态友好。
- [ ] 图片附件在对话框内预览；PDF/音视频新标签页内联打开；其他类型触发下载。
- [ ] 未引用附件可删除，删除后列表与用量即时刷新；被引用附件删除给出「使用中」提示（409 解析经 apiErrorMessageFromUnknown，memory #55）。
- [ ] 用量区块显示总用量；子任务2 已归档时显示用量/配额与百分比。
- [ ] pending 行（sizeBytes=0）不导致渲染异常。
- [ ] 移动端：列表行 tap 展开操作、对话框可点外关闭。
- [ ] 他人文件 id 不可通过列表/预览/删除触达（404 语义，既有 ownership 校验）。
- [x] 分类筛选：图片/文档/音频/视频各自只出现对应类型附件，「全部」显示所有；非法 category 参数 400；筛选后分页与 totalCount 正确。
- [ ] 批量选择：行 checkbox + 表头全选（仅未引用行可选）；工具条删除 → 确认 → 汇总结果；使用中行被跳过且状态刷新；选择集随分类切换清空。
- [ ] 新上传文件的 S3 对象 key 带原始扩展名（`<userId>/<fileId>.<ext>`）；旧行不受影响。
- [ ] 集成测试不向真实存储桶写入对象（hermetic 存储 + 泄漏断言）。
- [ ] 既有测试全部通过。

## Out of Scope

- 管理员跨用户文件视图、供应商侧对账 UI（父任务拍板砍掉）。
- 服务端批量删除接口（客户端逐条调用即可，附件量级小）。
- 配额配置 UI（子任务2）、composer 改动。
- 文件重命名、文件夹/标签组织。

## Open Questions

（无）
