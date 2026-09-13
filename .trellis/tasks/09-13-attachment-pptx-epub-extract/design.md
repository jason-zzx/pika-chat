# 技术设计：pptx/epub 解析

## 1. 边界与落点

改动集中在三处，不动发送/回放/UI 主流程：

- `src/lib/files/media-types.ts`：白名单 + accept + 分类（isomorphic，前后端共用）。
- `src/server/files/extract/`：新增两个解析器模块 + 调度器分支。
- 测试：解析器单测 + 调度器单测，沿用 office.test.ts / index.test.ts 模式。

新增依赖：`jszip`（zip 解包）+ `@xmldom/xmldom`（XML DOM，getElementsByTagName 语义贴合 pptx 场景）。epub 的 XHTML→Markdown 复用已有 `node-html-markdown`。不引入 epub 专用库（epubjs 面向浏览器渲染，`@smoores/epub` 等为元数据导向，均过重）。

## 2. 分类与调度

`media-types.ts`：

- 新增 `PPTX_MEDIA_TYPE` / `EPUB_MEDIA_TYPE` 常量。
- `FileCategory` 决策：pptx 并入现有 `"office"` 类别（office.ts 内部分发加一支，改动最小，且 20MB/ZIP 校验语义相同）；epub 新增 `"ebook"` 类别，调度器加 `case "ebook"`。两者路由语义都与 office 一致（永远抽取，无原生传输）。
- `SUPPORTED_FILE_ACCEPT` 追加 pptx 媒体类型与 `.pptx`、`.epub` 扩展名。

`extract/index.ts` 调度器：`office` 不变（office.ts 内部加 pptx 分支）；新增 `ebook` 分支调 `extractEpub`。清洗仍在调度器统一施加，解析器不各自清洗。

## 3. pptx 解析器（extract/slides.ts 或 office.ts 内新函数）

```
buffer → ZIP 签名校验（复用 office.ts 的 ZIP_SIGNATURE 判定，抽到共用位置）
  → jszip.loadAsync → 列出 ppt/slides/slideN.xml，按 N 数值排序
  → 每页 xmldom 解析：getElementsByTagName('a:p') → 段内 'a:t' join('') → 段间 '\n'
  → notesSlides/notesSlideN.xml 同法抽取（同页码匹配），非空则附
  → 输出：
      ## Slide 1
      <正文>

      Notes:
      <备注>
```

- 全部页均无文本且无 notes → `empty`。
- 单页解析失败不致命：跳过该页并在结果里保留其余页（对齐 lobe 的容错取向）；全部失败 → `failed`。
- 排序必须用数值（slide10 不能排在 slide2 前）——lobe 实现的教训。
- 不进主 bundle 问题：本项目的解析全部在 server-only 上传路径，一次性 import 即可，无需 lobe 的懒加载模式。

## 4. epub 解析器（extract/ebook.ts）

```
buffer → ZIP 签名校验 → jszip
  → 读 META-INF/container.xml → xmldom 取 rootfile full-path（OPF 路径）
  → 解析 OPF：manifest（id → href）+ spine（itemref idref 顺序）
  → 按 spine 顺序读各 XHTML → node-html-markdown 转 Markdown
  → 章节间 '\n\n' 拼接
```

- 缺 container.xml / OPF / spine 空 → `failed`（带可读 error）。
- 单章转换失败跳过该章；全部章节为空 → `empty`。
- OPF 内 href 的相对路径基于 OPF 所在目录解析（常见坑：href 相对 OPF 而非 zip 根）。
- mediaType 归一化：`application/epub+zip` 无别名问题，但保留扩展名 `.epub` 兜底（浏览器 mediaType 可能为空）。

## 5. 截断与错误语义

- 复用 `truncateText`（truncate.ts）与现有预算常量，不新增配置。
- 错误分类复用现有：解析 throw → `failed` + errorMessage(error)；发送路径 `file.unreadable` / `file.noTextLayer` 既有 i18n key 直接生效，无需新增。

## 6. 关键取舍记录

1. **pptx 归 office 类别**：避免新增类别的连锁改动（路由、UI 标签）；office.ts 内部按 mediaType 分发即可。
2. **epub 单列 ebook 类别**：与 office 的 ZIP/XML 结构差异大，独立模块更清晰；路由语义相同所以无其他改动面。
3. **speaker notes 纳入**：lobe 未做，但 notes 恰是 pptx 的高信息密度部分，成本只是多扫一个目录。
4. **不做懒加载**：server-only 路径，一次性 import 即可。

## 7. 回滚

纯增量：白名单回收 + 调度器分支删除即回滚，无 schema 变更。
