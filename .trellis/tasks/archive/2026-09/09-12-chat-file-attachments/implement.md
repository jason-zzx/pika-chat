# 执行计划：聊天附件上传与解析（一期）

> 依赖关系：步骤 1–3 是纯后端地基，可顺序提交；4–5 依赖 1–3；6 依赖 4；7 贯穿全程。

## 实施清单（有序）

1. **数据层**
   - [x] `src/server/db/schema/file.ts`：`files` 表 + `file_extraction_status` enum（design §2）
   - [x] `pnpm db:generate` 生成迁移；`pnpm db:migrate` 本地验证
   - [x] `src/server/env.ts` 增加 `FILE_STORAGE_DIR`；`.gitignore` 增加 `.data/`
2. **存储抽象**
   - [x] `src/server/files/storage.ts`：`FileStorage` 接口 + `LocalDiskFileStorage` + `getFileStorage()` 单例
   - [x] 单测：put/get/delete 往返、key 隔离（vitest + tmp dir）
3. **抽取管线**
   - [x] 安装依赖：`unpdf`、`mammoth`、`xlsx`（+ `node-html-markdown` 用于 docx 表格）
   - [x] `extract/pdf.ts`（逐页、截断、空层）、`extract/office.ts`、`extract/text.ts`、`extract/index.ts` 分发器
   - [x] 单测：fixture PDF（有文本层/扫描件/加密）、docx、xlsx、txt；截断标志；错误分类
   - [x] 常量：`MAX_FILE_BYTES = 20MB`、`MAX_ATTACHMENTS_PER_MESSAGE = 5`、`MAX_EXTRACTED_CHARS = 100_000` 集中于 `src/lib/files/constants.ts`
4. **文件服务与 API**
   - [x] `src/server/files/file.service.ts`：上传校验、即时抽取落库、归属校验、引用检查（jsonb 包含查询）、孤儿清扫、级联删除辅助
   - [x] `src/app/api/files/route.ts`（POST）、`src/app/api/files/[id]/route.ts`（GET/DELETE），走 `withErrorHandling` + `requireActor`
   - [x] `deleteMessage` / `deleteTopic` 级联清理文件
   - [x] 集成测试：上传→下载→归属 403/404→删除已引用 409
5. **聊天链路接入**
   - [x] `chatFilePartSchema` 加入 `chatRequestMessageSchema` / `chatStoredPartSchema`（src/lib/schemas/chat.ts:48-66）
   - [x] `src/server/ai/attachments.ts`：`resolveAttachmentsForModel`（design §5 路由表）+ 单测（四类别 × 支持/不支持矩阵）
   - [x] `/api/chat`：附件校验（归属/数量/重写 url）→ `requestToUserMessage` 透传 file parts → 回放前调用路由模块；解析先于落库（修复 topic 卡死）
   - [x] regenerate 路由同点接入
   - [x] `appendUserMessage` 放开 text-only filter（message.service.ts:197）
6. **前端**
   - [x] Composer：附件按钮/粘贴/拖拽、chip 状态机、composer-store 暂存桶、发送组装 `sendMessage({ text, files })`
   - [x] MessageItem：附件卡片（含大小）+ 图片缩略图
   - [x] i18n：`Files` 命名空间 + `Errors.file.*` / `Errors.actions.sendMessage`（en.json / zh-CN.json）
   - [x] 组件测试：chip 状态流转、附件消息渲染
7. **质量门（每步后运行）**
   - [x] `pnpm lint && pnpm typecheck && pnpm test`
   - [x] `pnpm build`
   - [x] 两轮 trellis-check 复核（阻断项 B1 与 PRD 缺口 I1–I3/M1–M3 已修复）

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate   # 步骤 1 后
TEST_DATABASE_URL=... pnpm test -- integration   # 文件服务集成测试
```

手动验收（对照 PRD Acceptance Criteria 逐条）：视觉模型看图、纯文本模型读 PDF 抽取文本、扫描件报错、docx/xlsx 结构化、超限/越界/截断提示、换模型重路由。

## 高风险点与回滚

| 风险点 | 说明 | 回滚 |
|---|---|---|
| `appendUserMessage` filter 放开 | 影响所有用户消息持久化路径 | 单行回退 |
| 迁移 | 纯新增表，无外键指向既有表 | `drop table files` |
| unpdf 在 Next.js server bundle 的兼容性 | pdfjs 系库在 bundler 下偶发 worker 路径问题；若中招，用 `serverExternalPackages` 排除 | 换裸 pdfjs-dist |
| regenerate 路径遗漏路由转换 | 会导致换模型重生成时附件丢失/报错 | 清单步骤 5 已列，检查清单验收 |

## 开工前检查

- [x] PRD 收敛通过（无未决 open question）
- [x] implement.jsonl / check.jsonl 已配置 spec 条目
- [x] 用户批准最终规划摘要后才 `task.py start`
