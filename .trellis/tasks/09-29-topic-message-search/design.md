# 设计：话题与消息全文搜索

## 1. 数据流

```
SidebarSearch (输入, 300ms 防抖)
  → useQuery(["search", q]) → GET /api/search?q=
    → resolveActor → searchForActor(actor, q)
      → topics 命中 (title ILIKE, join assistants 校验归属)
      → chat_messages 命中 (jsonb_array_elements text part ILIKE, isSelected, join topics+assistants)
      → app 侧生成 snippet
  ← { topics: TopicHit[], messages: MessageHit[] }
点击消息命中 → router.push(/assistant/{aid}/{tid}?m={groupId})
  → ChatView 首挂载消费 m → messageListRef.scrollToMessage(m) + 高亮 → router.replace 去参
```

## 2. 搜索 SQL 形状（drizzle）

话题组：

```ts
db.select({ ...topicColumns, assistantId: topics.assistantId })
  .from(topics).innerJoin(assistants, eq(assistants.id, topics.assistantId))
  .where(and(eq(assistants.ownerId, actor.userId), ilike(topics.title, pattern)))
  .orderBy(desc(topics.updatedAt)).limit(20)
```

消息组（匹配条件）：

```ts
sql`exists (
  select 1 from jsonb_array_elements(${chatMessages.parts}) p
  where p->>'type' = 'text' and p->>'text' ilike ${pattern}
)`
```

外加 `eq(chatMessages.isSelected, true)` + 归属 join；取 `id, groupId, role, createdAt, parts, topicId, topicTitle, assistantId`，按 `createdAt desc` limit 20。

**ILIKE 转义**：`q.replace(/[\\%_]/g, (c) => "\\" + c)`，pattern = `%${escaped}%`，ILIKE 默认反斜杠转义（Postgres `standard_conforming_strings=on` 下 drizzle 参数化传值安全）。

**Snippet**：对命中行的 parts 顺序拼接 text part 文本，找首个不区分大小写命中位置，**非对称开窗**：头部只留 ~16 字符上下文（超出加省略号），其余长度给匹配词之后（总窗 ~120 字符）。原因（一轮验收反馈）：`line-clamp-2` 在侧边栏宽度下只能容纳约两行，对称 ±60 会把匹配词挤出可见区。

**标题开窗**：话题标题命中时，若标题短直接整体渲染 + `<mark>`；若标题长到匹配词会被 `truncate` 切掉，则围绕匹配位置开窗（首尾省略号）——匹配文本必须在可见区域内，与摘要同一原则。

## 3. API

`GET /api/search?q=...`
- 无 actor → 401（沿用现有 route 惯例）。
- `q` trim 后为空 → `{ topics: [], messages: [] }`（200，不算错误）。
- `q` 长度上限 200（截断，不报错）。
- 响应 schema 放 `src/lib/schemas/search.ts`（zod，前后端共用类型推导）。

## 4. 前端

**`src/components/assistant/SidebarSearch.tsx`**（新）：
- `SidebarHeader` 之下常驻一行搜索输入（`Input` + `Search` 图标 + 清除按钮）。
- `debouncedQuery.length > 0` 时，用 `useQuery({ queryKey: ["search", q], enabled, placeholderData: keepPreviousData })` 查询；AssistantTree 内容区渲染 `SearchResults` 替代树（同 pane 内替换，无弹窗无定位问题）。
- 结果两组分组标题；话题项显示图标+标题；消息项显示话题标题 + snippet（命中词 `<mark>` 高亮，前端对 snippet 做安全拆分渲染，不用 dangerouslySetInnerHTML）。
- Esc / 清空 → 恢复树。icon 折叠态：输入行隐藏，渲染搜索图标按钮，点击 `toggleSidebar` 展开并聚焦（`document` 聚焦 ref）。

**ChatView `?m=` 消费**：
- `useSearchParams` 读 `m`，`useEffect` 在 `messages` 非空且未消费过时执行：`messageListRef.current?.scrollToMessage(m)`，设置高亮 key state（传至 MessageList → MessageItem，命中行加一次性 `animate`/背景 class，2s 后清），再 `router.replace` 当前路径去 `m`。
- 高亮实现：MessageList 增加可选 prop `highlightKey?: string`，命中行加高亮 class，2s 后清。**高亮样式（三轮定稿）**：不新增颜色 token，复用每个 preset 自己的 `--primary`（主题注意力色；mono 主题下退化为墨色）。行闪烁 = `bg-primary/8` + `ring-2 ring-inset ring-primary/50`（描边轮廓是视觉抓手，不是底色）；匹配词 `<mark>` 无背景无 padding（不撑开单词）：`font-semibold text-primary underline decoration-2 underline-offset-2 decoration-primary/40`。彩色 preset 下高亮自动带主题色相。
- 目标消息不存在（已删除）→ 静默不滚动，仍去参。

## 5. 兼容与边界

- 不回溯搜索未选中版本、不搜 reasoning / tool part / 附件提取文本（YAGNI；text part 覆盖用户与助手正文）。
- 压缩摘要（`topics.summaryText`）不参与搜索。
- 结果跳转依赖消息全量加载现状；若未来引入分页需重审（写进 PRD 风险即可，不现在设计）。
- 无新依赖、无 DB migration（ILIKE 顺序扫描，单用户数据量下可接受；真有性能问题再加 pg_trgm 索引）。

## 6. 文件清单

| 文件 | 动作 |
|---|---|
| `src/server/services/search.service.ts` | 新增 |
| `src/server/services/search.service.integration.test.ts` | 新增 |
| `src/app/api/search/route.ts` | 新增 |
| `src/lib/schemas/search.ts` | 新增 |
| `src/components/assistant/SidebarSearch.tsx` + `.test.tsx` | 新增 |
| `src/components/assistant/AssistantTree.tsx` | 接入搜索行 + 结果替换树 |
| `src/components/chat/ChatView.tsx` | 消费 `?m=` + 高亮状态 |
| `src/components/chat/MessageList.tsx` / `MessageItem.tsx` | `highlightKey` prop |
| `messages/en.json` / `messages/zh-CN.json` | `Search.*` key |
