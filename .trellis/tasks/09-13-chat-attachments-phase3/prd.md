# 聊天附件三期：附件管理页、配额与大文件放宽（父任务）

## Goal

在二期「存储/传输/解析」架构演进之上，补齐附件体系的用户侧与运营侧能力：用户附件管理页（含存储用量展示）、管理员存储配额配置、Claude Files API 孤儿文件自动清理、大文件上限放宽（env 控制，最大 100MB）、presigned URL 直连上传（env 控制，默认服务端中转）。

## Background / Confirmed Facts

历史决策（归档任务记录）：

- 二期父任务 PRD（09-13-chat-attachments-phase2）明确：**附件管理页、管理员配额配置界面推迟到三期**（2026-09-13 拍板）。
- 二期 files-api 子任务 design.md:149 记录已知债务：**Claude 侧 Files API 文件不过期且无列表/清理 UI**，"三期附件管理页一并考虑"；Google 侧 48h 自动过期无需处理。
- 二期 files-api 子任务 PRD/design：**20MB 单文件上限维持不变，大视频依赖引用传输的放宽留三期**。

代码现状（2026-09-13 核实）：

- `files` 表（src/server/db/schema/file.ts）：id / userId / filename / mediaType / sizeBytes / storageKey / extractedText / extractionStatus / providerReferences(jsonb，按 provider config id 键控，含 uploadedAt/expiresAt) / createdAt。**无配额相关列**。
- 文件生命周期已具备（src/server/files/file.service.ts）：`deleteFile(id, actor)`、`deleteFilesIfUnreferenced`（消息删除级联）、`sweepOrphanFiles`（24h TTL 孤儿清扫）。
- 上传限制常量集中在 src/lib/files/constants.ts：`MAX_FILE_BYTES = 20MB`、`MAX_ATTACHMENTS_PER_MESSAGE = 5`。
- provider configs 是全局的（schema 无 userId，API key 管理员统一管理）；users.role 有 user/admin/super_admin。
- 设置页已有 users（管理员用户管理）、providers、search、account、general；设置页规范见 memory #42/#43/#44/#46。
- API 现状：`POST /api/files`（上传）、`GET /api/files/[id]`（下载/预览，归属校验）。**无列表/删除端点**。

业界调研（2026-09-13 会话，针对大文件上限）：

- LobeChat：聊天附件无全局大小校验，仅视频硬限 20MB；上传走 S3 presigned URL 客户端直连；云端口径 100MB 可配。
- Cherry Studio：无统一单文件上限；知识库节流 30 文件/80MB；文档处理服务分级限 50MB/200MB/1GB。
- Open WebUI：`RAG_FILE_MAX_SIZE` 默认**无限制**，管理员可配；实际瓶颈常在反代。

## 用户已拍板的范围决定（2026-09-13，全部确认）

- **A/B/C/D/E 全部纳入本期**，精简为 3 个子任务（见子任务映射）。
- **D 大文件放宽**：上限由环境变量控制，**默认维持 20MB，最大可配到 100MB**。
- **E presigned URL 直连上传**：由环境变量控制开关，**默认关闭（走服务端中转现状）**。
- **B 配额模型**：仅**存储总量配额**（用户附件字节数之和）；**超限硬拒绝**（上传时报错，含当前用量/配额）；粒度为**全局默认 + 管理员按用户覆盖**，**全局默认 5GB**（2026-09-13 第四轮拍板；管理员可改可清空，清空=不限）。不做单文件配额（D 的 env 上限已覆盖）、不做单日上传量。
- **A 管理页形态**：新建设置页 `/settings/files`（符合 memory #43/#46 设置页规范），含用量展示与**粗分类筛选**（全部/图片/文档/音频/视频，第四轮拍板）。
- **C Claude 孤儿清理：全自动、零 UI**（第三轮拍板简化：管理员不会手动对账，对账面板砍掉）：
  - **删除联动（源头）**：`deleteFile` / `deleteFilesIfUnreferenced` / `sweepOrphanFiles` 删除本地记录前，对 `expiresAt === null` 的引用（即 claude）调 Anthropic Files API 删除供应商侧文件；best-effort，失败不阻塞本地删除。
  - **有界重试（兜底）**：联动删除失败（429/5xx/网络类）的引用写入持久化待删队列，sweep 时惰性重试，指数退避（1h→4h→12h→24h→48h）**最多 5 次**后放弃 + warn 日志；404 视为删除成功出队；401/403 立即放弃 + warn 日志。
  - **无全量对账**：从不调 `GET /v1/files`；所有 API 调用都是凭 DB 记录对已知 file id 的 DELETE。无上传→无引用→零调用；队列为空→零调用；无误删同 key 下他应用文件的风险。
  - **存量孤儿**（二期积累 + 已删 config 失联引用）：一次性脚本/手动清理，不建 UI。
  - delete 走 Anthropic REST 直连（AI SDK `.files()` 只有 upload），收敛在 provider-files.ts 新增函数。

## 子任务映射（3 个）

| 子任务 | 交付物 | 依赖 | 建议顺序 |
|--------|--------|------|----------|
| attachment-upload-pipeline | C+D+E：env 大小上限（默认 20MB/最大 100MB）、presigned 直连开关（默认关）、Claude 孤儿删除联动 + 有界重试 | 仅依赖二期既有 file.service / provider-files | 1 |
| attachment-quota | B：存储总量配额（schema + 上传硬拒绝 + 管理员配置 UI） | 仅依赖 files 表 / users 表 | 2 |
| attachment-management-page | A：/settings/files 管理页（列表/预览/删除 + 用量展示） | 删除复用 deleteFile | 3 |

三个子任务互相无代码依赖，可独立 implement / check / archive；上表顺序只是建议，不是阻塞关系。

软协作点（写入各自 PRD，不构成阻塞）：A 的用量区块在 B 落地后可补「用量/配额」百分比展示。

## Cross-Child Acceptance Criteria（父任务集成审查用）

- [ ] 三个子任务全部归档后，一、二期全部既有验收场景（上传、路由、降级、Files API 引用、错误提示）无回归。
- [ ] env 默认值下（20MB 上限、presigned 关），上传链路行为与二期完全一致。
- [ ] 本地删除附件后，Claude 供应商侧文件被联动删除，失败进入有界重试并最终放弃，无无限重试、无 UI 依赖。
- [ ] 配额超限上传被硬拒绝且错误信息含当前用量与配额；按用户覆盖优先于全局默认；migration 后默认全局配额 5GB。
- [ ] /settings/files 可列出、预览、删除本人附件并展示存储用量；支持图片/文档/音频/视频粗分类筛选；移动端 tap 路径可用（memory #15）。

## Out of Scope（历史已拍板，除非用户推翻）

- 扫描件 OCR、外部文档预处理服务（2026-09-13 拍板不做）。
- RAG / 知识库（一期 PRD：独立功能，不在附件体系内）。
- openai-compatible 渠道的 Files API（二期判定投入产出比低）。
- 音频转录与视频内容解析。
- Claude 孤儿文件的管理员对账 UI / 全量 `GET /v1/files` 对账（第三轮拍板砍掉，改为全自动联动+有界重试）。
- 单文件配额、单日上传量配额。

## Notes

- 父任务不做直接实现；实现发生在各子任务。父任务在所有子任务归档后做最终集成审查再归档。
