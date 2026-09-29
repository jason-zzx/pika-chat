# 执行计划：话题与消息全文搜索

## Checklist

1. [x] `src/lib/schemas/search.ts` — zod schema（TopicHit / MessageHit / SearchResponse）
2. [x] `src/server/services/search.service.ts` — `searchForActor(actor, query)`：ILIKE 转义、话题组、消息组（jsonb_array_elements + isSelected + 归属）、snippet 生成
3. [x] `src/server/services/search.service.integration.test.ts` — 命中/归属隔离/转义/snippet/isSelected 过滤
4. [x] `src/app/api/search/route.ts` — GET，actor 鉴权，空 q 空结果，q 截断 200
5. [x] `src/components/assistant/SidebarSearch.tsx` — 输入行 + 防抖 useQuery + 结果分组渲染 + 点击跳转（结果列表拆为 `SearchResults.tsx`，hook 在 `use-search.ts`）
6. [x] `AssistantTree.tsx` — 接入 SidebarSearch，搜索激活时内容区替换为结果
7. [x] `ChatView.tsx` — `?m=` 消费（scrollToMessage + highlightKey + router.replace 去参）
8. [x] `MessageList.tsx` / `MessageItem.tsx` — `highlightKey` prop + 高亮 class（2s 清除）
9. [x] `messages/en.json` / `messages/zh-CN.json` — `Search.sidebar.*`（`Search` 命名空间已被网页搜索设置占用，按键名规则嵌套 `sidebar` 子键）
10. [x] `SidebarSearch.test.tsx` — jsdom 主路径（输入→渲染结果→点击跳转 href）

## 验证命令

- `pnpm vitest run src/server/services/search.service.integration.test.ts`（集成测试需 integration 环境，参考 vitest.integration.*）
- `pnpm vitest run src/components/assistant/SidebarSearch.test.tsx`
- `pnpm lint && pnpm typecheck && pnpm test`
- 手动：`pnpm dev`，搜索中文/英文/`%`，点击消息结果验证滚动定位与高亮，Esc 恢复树

## 回滚

- 全部为新文件 + 三处接入点（AssistantTree / ChatView / MessageList prop），`git revert` 单提交即可；无 DB migration，无数据兼容问题。

## Review Gates

- R1–R2 完成后跑集成测试再过前端
- 前端完成后全量 `pnpm test` + 手动验证

## 第二轮（验收反馈，R7）

1. **定位高亮太弱** — `MessageItem.tsx` `HIGHLIGHT_CLASS`：`bg-accent/60` 洗色改为全不透明 `bg-accent` + `ring-2 ring-inset ring-foreground/30`（单色 token 体系内，亮/暗均可见），`motion-reduce` 与 `-mx-2 px-2` 布局补偿保留，transition 扩为 `[background-color,box-shadow]`。
2. **话题标题命中无高亮** — `SearchResults.tsx`：标题组改用 `HighlightedTitle`（复用 `<mark>` 拆分渲染）；标题超过 48 字符时围绕匹配位置开窗（头部 16 字符 + 首尾省略号，`windowAroundMatch`），`truncate` 不再可能切掉匹配词。
3. **摘要窗口对称导致匹配词被挤出可见区** — `search.service.ts` `buildSnippet`：`SNIPPET_RADIUS=60` 对称窗改为非对称（`SNIPPET_HEAD=16` / `SNIPPET_TOTAL=120`），保证匹配词落在 `line-clamp-2` 的前两行内。

测试同步：集成测试窗口断言更新并新增「匹配词位置 ≤30」不变量；`SidebarSearch.test.tsx` 新增标题 `<mark>` 断言与长标题开窗用例。`pnpm lint` / `typecheck` / `test`（152 文件 / 1370 用例）全绿。

## 第三轮（高亮重设计，R7a 定稿）

两轮失败根因：主题单色灰，accent/foreground 任意组合都是灰上灰。**定稿 = 专用功能色**（find-in-page 惯例的琥珀黄）：

1. `src/app/globals.css` — `@theme inline` 新增 `--color-highlight` / `--color-highlight-foreground` / `--color-highlight-edge` 映射；`:root` / `.dark` / 6 preset × light/dark 共 14 块均声明（`check:themes` 同构约束）。功能色非调色板身份，所有 preset 同值：light `0.92 0.10 95` / `0.35 0.06 90` / `0.70 0.15 85`；dark `0.82 0.13 92` / `0.26 0.05 90` / `0.72 0.14 85`（oklch）。
2. `MessageItem.tsx` `HIGHLIGHT_CLASS` — on = `bg-highlight/45` + `ring-2 ring-inset ring-highlight-edge`；off 补齐 `ring-2 ring-inset ring-transparent`（同布局零位移）。
3. `SearchResults.tsx` `<mark>` — `bg-accent text-accent-foreground` → `bg-highlight text-highlight-foreground rounded-sm px-0.5`（marker-pen 观感，“搜索命中 = 琥珀色”统一语言）。
4. spec 同步：`theming.md`（功能色家族跨块声明规则）、`component-guidelines.md`（Status color 段加入 `--highlight*` 说明）、`backend/search.md`（样式契约指针）。
5. 测试：`ChatView.test.tsx` 的闪烁断言 `bg-accent` → `bg-highlight`（jsdom 无布局，class 断言是既定模式，#233）。

## 第四轮（高亮定稿）

琥珀色 `--highlight*` 实验被否决（破坏主题一致性；`mark` padding 把单词撑开）。**定稿 = 不新增颜色**，复用每个 preset 自己的 `--primary`（主题注意力色：paper=暖棕，graphite/ocean=蓝，forest=绿，rose=粉，violet=紫，mono 默认=墨色），所有 preset × light/dark 自动主题适配。

1. `src/app/globals.css` — 回退第三轮新增：`@theme inline` 的 3 条 `--color-highlight*` 映射 + 14 个块的 `--highlight*` 声明全部移除（共 45 行）。`pnpm check:themes` 通过（块间 token 集恢复一致）。
2. `MessageItem.tsx` `HIGHLIGHT_CLASS` — on = `bg-primary/8` + `ring-2 ring-inset ring-primary/50`；off 保持 `bg-transparent ring-transparent`（零布局位移，ring 槽位保留）。描边轮廓是 mono 主题下的视觉抓手，不是底色。
3. `SearchResults.tsx` `<mark>` — 保留语义元素，样式改为 `bg-transparent font-semibold text-primary underline decoration-2 underline-offset-2 decoration-primary/40`；无 padding 无圆角背景，不撑开匹配词。
4. spec 同步：`theming.md`（功能色家族规则改回仅 `--success`，新增「瞬时强调色复用 preset 自身 `--primary` 低透明度」规则）、`component-guidelines.md`（Status color 段：单色规则不变，搜索命中用 `--primary` tint）、`backend/search.md`（样式指针更新）。
5. 测试：`ChatView.test.tsx` 断言 `bg-highlight` → `bg-primary/8`；`SidebarSearch.test.tsx` 仅断言 `<mark>` 元素存在与文本，无需改。`pnpm check:themes` / `lint` / `typecheck` / `test` 全绿。
