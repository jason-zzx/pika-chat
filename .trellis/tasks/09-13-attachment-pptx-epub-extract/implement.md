# 执行计划：pptx/epub 解析

## 实施清单（有序）

1. [x] 安装依赖：`jszip`、`@xmldom/xmldom`（+ `@types/yauzl` 类不需要；确认 jszip 自带类型）。
2. [x] `src/lib/files/media-types.ts`：新增 `PPTX_MEDIA_TYPE` / `EPUB_MEDIA_TYPE`；pptx 入 `OFFICE_MEDIA_TYPES`；epub 新增分类逻辑（`"ebook"`）；更新 `SUPPORTED_FILE_ACCEPT`；补 `.pptx` / `.epub` 扩展名兜底。
3. [x] office.ts：抽出 ZIP 签名校判为共用 helper；新增 `extractPptx`（slides + notesSlides，数值排序，单页容错）。
4. [x] 新增 `extract/ebook.ts`：`extractEpub`（container.xml → OPF → spine → XHTML → node-html-markdown）。
5. [x] `extract/index.ts`：新增 `ebook` 分支；确认清洗对两者生效。
6. [x] 单测：`slides`（多页顺序、notes、空 pptx、非 ZIP、slide10 排序）、`ebook`（spine 顺序、缺 container.xml、空章节、相对 href）、`index.test.ts` 分发与清洗回归。
7. [x] 手测：composer 上传 pptx/epub → chip 状态正确 → 发送后模型回答体现内容；换无特殊能力模型仍走抽取注入。

## 验证命令

```bash
pnpm vitest run src/server/files/extract
pnpm lint && pnpm type-check   # 以仓库实际 script 名为准
```

手测夹具：自制 3 页含 notes 的 pptx（python-pptx 或 Keynote 导出）、一本公版 epub（Project Gutenberg）。

## 高风险点与回滚

- **xmldom 对畸形 XML 的容错**：pptx/OPF 来自真实软件可能有命名空间混杂；用 getElementsByTagName 的局部名匹配而非 XPath，测试夹具覆盖 Keynote/PowerPoint/WPS 各一份（至少两类）。
- **epub href 相对路径**：相对 OPF 目录而非 zip 根；单测必须覆盖 OPF 在子目录的样本（如 `OEBPS/content.opf`）。
- 回滚：白名单回收 + 分支删除，无 schema 变更，随时可退。

## 开工前检查

- [x] `task.py start` 前 prd/design/implement 已经用户审阅。
- [x] implement.jsonl 已配置（spec 清单）。
