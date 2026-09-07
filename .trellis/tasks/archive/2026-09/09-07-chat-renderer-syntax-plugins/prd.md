# 聊天渲染器语法增强

## Goal

为聊天消息渲染器（`MessageItem.tsx` 中的 Streamdown）接入四个官方插件：代码语法高亮（@streamdown/code）、数学公式 KaTeX（@streamdown/math）、Mermaid 图表（@streamdown/mermaid）、CJK 友好强调解析（@streamdown/cjk）。

## Background

当前 `<Streamdown>{part.text}</Streamdown>` 未传任何 `plugins`。streamdown v2 核心只内置 GFM（表格/删除线/任务列表/脚注/自动链接），高级语法全部靠独立插件包。缺口：

1. 代码块无语法高亮（纯文本 pre/code，有 header + 复制按钮）
2. `$...$` / `$$...$$` 数学公式原样显示为文本
3. ` ```mermaid ` 围栏退化为普通代码块
4. CJK 场景下强调/删除线解析失败（CommonMark flanking 规则，中文聊天高频触发，属正确性 bug）

## Requirements

- R1: 围栏代码块使用 Shiki 高亮，跟随应用明暗主题（github-light / github-dark 双主题，streamdown 已内置 `dark:` 切换）。
- R2: 数学公式经 KaTeX 渲染。启用 `singleDollarTextMath: true`（模型常输出 `$...$` 行内公式；remark-math 要求 `$` 后无空白，价格类文本如 `$5` 不会误判）。KaTeX 字形继承 currentColor，明暗主题自动适配。
- R3: ` ```mermaid ` 围栏渲染为图表（streamdown 核心自带懒渲染、缩放/全屏/下载控件），图表主题跟随应用明暗模式。
- R4: CJK 插件全局启用，修复中文字符相邻时 `**加粗**` / `~~删除~~` 解析失败。
- R5: 包体积控制：shiki / katex / mermaid 均为重量级依赖，不得进入首屏 chunk —— 插件通过动态 `import()` 加载；mermaid 仅在消息文本含 mermaid 围栏时加载。插件加载完成前保持当前降级渲染（纯文本代码块、原文公式），加载后原地升级，不闪动布局。
- R6: 移动端触控可用（约束 #15）：mermaid 缩放/全屏控件基于 pointer events，触屏可点；不引入 hover-only 交互。
- R7: 用户消息气泡不经过 Streamdown（纯文本段落），本次改动只影响 assistant 消息渲染，用户消息行为不变。
- R8:（手动验证发现的 bug）streamdown 内建复制按钮（代码块 / mermaid / table）在非安全上下文（局域网 http IP）调用 `navigator.clipboard` 失败。streamdown 内部直接调用 Clipboard API，无法注入本项目的 `copyTextToClipboard`，因此在应用层 polyfill：当 `navigator.clipboard` 不存在时定义一个走 legacy textarea + execCommand 的实现（writeText 与 write，后者降级复制 text/plain 部分），使 streamdown 与本项目的复制按钮行为一致。
- R9:（手动验证发现的 bug）mermaid `theme: "dark"` 内建配色与应用暗色主题不协调（部分节点亮底、部分暗底）。暗色模式改用 `theme: "base"` + `themeVariables`，取与 globals.css `.dark` token 协调的颜色（mermaid 颜色派生用 khroma 解析，oklch 可能不兼容，用对应 hex 值）；亮色模式保持 mermaid `default` 主题。

## Out of Scope

- `==高亮==`、`^上标^` / `~下标~`（streamdown 不支持，需自写 remark 插件）
- 代码块行号、动画等 streamdown 附加能力的调优（保持默认）
- 用户消息的 markdown 渲染

## Acceptance Criteria

- [x] assistant 消息中的围栏代码块有语法高亮，明暗主题下配色均正确
- [x] `$E=mc^2$` 与 `$$...$$` 渲染为 KaTeX 公式；非法公式降级为带错误色的文本，不崩溃
- [x] ` ```mermaid ` 围栏渲染为 SVG 图表；无 mermaid 内容的消息不触发 mermaid 网络请求
- [x] 「这是**加粗**测试」等 CJK 相邻标点的强调/删除线正确解析
- [x] 局域网 http（非安全上下文）下代码块 / mermaid / table 的复制按钮与消息操作区复制按钮均能成功复制
- [x] 暗色模式下 mermaid 图各节点配色统一协调，无亮底/暗底混杂
- [x] 首屏 chunk 不含 shiki / katex / mermaid（`next build` 输出验证）
- [x] 插件加载前内容可读（降级渲染），加载后无布局跳动
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test` 通过

## Notes

- 插件版本（2026-09 调研）：@streamdown/code 1.1.1（shiki ^3.19）、@streamdown/math 1.0.2（katex ^0.16.27）、@streamdown/mermaid 1.0.2（mermaid ^11.12）、@streamdown/cjk 1.0.3，均兼容 react 19。
- Streamdown props memo 比较含 `plugins` 引用，插件对象必须稳定（模块级缓存 promise + state 一次性设置）。
