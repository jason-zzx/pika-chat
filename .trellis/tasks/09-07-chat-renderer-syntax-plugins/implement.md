# 执行计划：聊天渲染器语法增强

## Checklist

1. [x] 安装依赖：`pnpm add @streamdown/code @streamdown/math @streamdown/mermaid @streamdown/cjk katex`（katex 需为直接依赖以便 import CSS；@types/katex 不需要，不引用其 API）
2. [x] 新建 `src/components/chat/markdown-plugins.ts`：`loadBasePlugins` / `loadMermaidPlugin` / `textNeedsMermaid` / `useStreamdownPlugins`
3. [x] 新建 `src/components/chat/Markdown.tsx`：Streamdown 包装 + `useIsDark`（useSyncExternalStore + MutationObserver 订阅 `<html>` class）
4. [x] 改 `src/components/chat/MessageItem.tsx`：assistant 分支 `<Streamdown>` → `<Markdown text={part.text} />`，移除 streamdown import
5. [x] 新建 `src/components/chat/markdown-plugins.test.ts`：`textNeedsMermaid` 边界（行首/缩进/含语言后缀/非 mermaid 围栏）+ hook 状态迁移（mock loader）
6. [x] 检查既有测试：MessageItem / MessageList / ChatView 的 `vi.mock("streamdown")` 继续生效；必要时补 mock `markdown-plugins`
7. [x] 验证：`pnpm lint && pnpm typecheck && pnpm test`
8. [x] `pnpm build`：确认首屏 chunk 不含 shiki/katex/mermaid
9. [x] 手动验证（dev）：代码高亮、行内/块级公式、mermaid 图、CJK 强调、明暗主题、触屏缩放

## 手动验证发现的回归（追加）

10. [x] 剪贴板 polyfill：新建 `src/lib/clipboard-polyfill.ts`（当 `navigator.clipboard` undefined 时用 `src/lib/clipboard.ts` 的 legacy 路径定义 writeText / write），在客户端入口（AppProviders 或 Markdown 模块）安装一次；加单测覆盖「clipboard 缺失时 streamdown 按钮路径可用」
11. [x] mermaid 暗色配色：Markdown.tsx 中暗色模式改用 `theme: "base"` + `themeVariables`（hex 值对齐 globals.css `.dark` token：background/card/foreground/muted-foreground/border），亮色保持 `default`
12. [x] 复跑 `pnpm lint && pnpm typecheck && pnpm test`，手动验证两项修复

## Review Gates

- 步骤 4 完成后：确认 MessageItem diff 最小、用户消息分支零改动
- 步骤 8：构建产物检查不通过则回到步骤 2 调整加载策略

## Rollback Points

- 任何一步失败：`git checkout -- src/components/chat/MessageItem.tsx` + 删除新文件即可回到现状；依赖可留（未被引用则无运行时代价）

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
