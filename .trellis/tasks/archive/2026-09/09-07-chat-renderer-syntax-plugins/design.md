# 技术设计：聊天渲染器语法增强

## 架构

新增两个文件，改动一个文件：

```
src/components/chat/
  Markdown.tsx              ← 新：Streamdown 包装组件（assistant 消息唯一入口）
  markdown-plugins.ts       ← 新：插件懒加载 + mermaid 检测（纯逻辑，可单测）
  MessageItem.tsx           ← 改：assistant 分支 <Streamdown> → <Markdown>
```

### markdown-plugins.ts

```ts
import type { PluginConfig } from "streamdown";

// 模块级缓存：所有 MessageItem 实例共享一次网络请求 + 一次插件创建
let basePluginsPromise: Promise<PluginConfig> | null = null;
let mermaidPromise: Promise<DiagramPlugin> | null = null;

export function loadBasePlugins(): Promise<PluginConfig> {
  basePluginsPromise ??= Promise.all([
    import("@streamdown/code"),
    import("@streamdown/math"),
    import("@streamdown/cjk"),
    import("katex/dist/katex.min.css"),   // CSS 随 JS chunk 按需加载
  ]).then(([code, math, cjk]) => ({
    code: code.code,
    math: math.createMathPlugin({ singleDollarTextMath: true }),
    cjk: cjk.cjk,
  }));
  return basePluginsPromise;
}

export function textNeedsMermaid(text: string): boolean {
  return /^```mermaid\b/m.test(text);
}

export function loadMermaidPlugin(): Promise<DiagramPlugin> {
  mermaidPromise ??= import("@streamdown/mermaid").then((m) => m.mermaid);
  return mermaidPromise;
}

export function useStreamdownPlugins(text: string): PluginConfig | undefined {
  // useState + useEffect：挂载后加载 base；textNeedsMermaid(text) 时再合并 mermaid
  // 返回 undefined 时 <Streamdown> 按现状降级渲染（无高亮/公式/图表），内容可读
}
```

要点：

- **插件身份稳定**：模块级 promise 缓存保证所有消息拿到同一插件对象；state 只被设置一次（undefined → 完整配置），Streamdown 的 memo（`plugins` 引用比较）不会失效抖动。
- **mermaid 条件加载**：`textNeedsMermaid` 命中的消息才触发 mermaid chunk 请求；mermaid 加载完成后通过 setState 合并出新 PluginConfig（引用变一次，触发该消息重渲染升级）。
- **katex CSS 走动态 import**：Next/webpack 会把 `katex.min.css` 打进该异步 chunk 的 CSS，不污染全局首屏 CSS；KaTeX 字体 woff2 按需请求。
- 不引 streamdown/styles.css（仅为 `animated` 逐词动画服务，本项目未用）。

### Markdown.tsx

```tsx
"use client";

export default function Markdown({ text }: { text: string }) {
  const plugins = useStreamdownPlugins(text);
  const isDark = useIsDark(); // 见下
  return (
    <Streamdown
      plugins={plugins}
      mermaid={{ config: { theme: isDark ? "dark" : "default" } }}
    >
      {text}
    </Streamdown>
  );
}
```

- `useIsDark()`：本项目主题是 cookie + `<html class="dark">`（`use-theme-sync.ts`），无 React context。用 `useSyncExternalStore` + MutationObserver 订阅 `<html>` class 变化，读取 `document.documentElement.classList.contains("dark")`。SSR 端恒 false，hydration 后校正（mermaid 本身仅客户端懒渲染，无不一致风险）。
- shiki 双主题不需要该 hook：streamdown 生成的 `dark:` Tailwind 类自动跟随 `.dark`（globals.css 已定义 `@custom-variant dark`）。

### MessageItem.tsx 改动

assistant 分支：

```diff
- <Streamdown key={index}>{part.text}</Streamdown>
+ <Markdown key={index} text={part.text} />
```

多 text part 各自独立渲染的现状保持不变。

## 数据流 / 渲染时序

1. 首条 assistant 消息挂载 → 触发 base 插件动态 import（约几百 KB chunk，异步）
2. 加载完成前：Streamdown 无插件降级渲染（代码块纯文本、公式原文），内容完整可读
3. 加载完成后：setState 传入 plugins，Streamdown 原地升级；shiki `highlight` 本身也是异步就绪（返回 null + callback），streamdown 内部处理 skeleton
4. mermaid 围栏消息额外请求 mermaid chunk；图表组件经 IntersectionObserver 进入视口才 render SVG

## 兼容性与风险

| 风险 | 缓解 |
|---|---|
| shiki/mermaid 体积 | 动态 import；mermaid 条件加载；`next build` 验证首屏 chunk 不含三者 |
| `$5 和 $10` 误判为公式 | remark-math 要求开 `$` 后非空白、闭 `$` 前非空白；价格场景不命中。接受残余误判（chat 应用通行做法） |
| 单条消息多 part 各自传 text 检测 mermaid | `textNeedsMermaid` 按 part 检测，无误 |
| 测试环境动态 import shiki 慢/重 | MessageItem 既有测试已 `vi.mock("streamdown")`；新增测试对 `@/components/chat/markdown-plugins` 的 loader 打 mock，只单测 `textNeedsMermaid` 纯函数与 hook 状态迁移 |
| 流式中途插件加载完成 | Streamdown memo 依赖 plugins 引用，切换一次即重渲染全部 block；文本越长越贵。可接受（一次性切换），不做优化 |

## 验证

- `pnpm lint` / `pnpm typecheck` / `pnpm test`
- `pnpm build`：检查 shiki / katex / mermaid 出现在异步 chunk 而非首屏
- 手动 dev 验证：高亮、`$...$`、`$$...$$`、mermaid、CJK 加粗、明暗主题切换、移动端触控缩放图表

## 回滚

改动集中于两个新文件 + MessageItem 一行替换；`git revert` 即可，无 schema / API 变化。
