# 消息翻译 — 技术设计

## 架构与边界

```
MessageActions (翻译图标 + 语言菜单)
   │ 选择目标语言
   ▼
POST /api/translate { messageId, targetLang, providerConfigId, modelId }
   │ 1. 归属校验 (message → topic → assistant → actor)
   │ 2. 命中缓存 translations[targetLang] → 直接返回
   │ 3. generateText (当前会话模型) "只输出译文"
   ▼
持久化 chat_messages.translations (jsonb, merge) → 返回译文
   │
   ▼
客户端更新消息缓存 → MessageItem 在正文下方渲染译文块
```

## 数据模型

- `chat_messages` 新增 `translations` `jsonb` nullable：`{ "zh-CN": "...", "en": "..." }`，键为 BCP-47 语言码。译文绑定到具体消息版本行（每个版本独立翻译，符合版本架构 #2）。
- `chatMetadataSchema`（src/lib/schemas/chat.ts）增加 `translations: z.record(z.string(), z.string()).optional()`；`listTopicMessages` 将列值映射进 metadata，刷新后译文仍在。

## 语言列表（共享常量）

新增 `src/lib/translate/languages.ts`（中性目录，前后端共用）：

```ts
export const TRANSLATE_TARGET_LANGUAGES = [
  { code: "zh-CN", nativeName: "简体中文" },
  { code: "en", nativeName: "English" },
  { code: "ja", nativeName: "日本語" },
  { code: "ko", nativeName: "한국어" },
  { code: "fr", nativeName: "Français" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "ru", nativeName: "Русский" },
] as const;
```

菜单项直接显示 `nativeName`，无需 i18n 翻译。不做原文语言排除（PRD 决策：同语言时模型原样返回）。

## 翻译提示词

服务端固定模板：目标语言 + "只输出译文，保持 markdown 结构与代码块不译，若原文已是目标语言则原样返回"。指令组装放在翻译路由私有 helper（不走 buildChatInstructions——该函数专用于聊天轮次，规则 #109）。

## 前端

- **MessageActions.tsx**：assistant 与 user 消息均显示 Languages 图标；点击展开 DropdownMenu（复用组件内既有 DropdownMenu 模式，注意触摸约束 #15/#16——沿用现有菜单的非 modal 处理），列出 8 种语言。
- **MessageItem.tsx**：`metadata.translations` 非空时在正文下方渲染译文块（muted 边框 + 语言标签 + 译文 Markdown）。译文渲染的 Markdown 组件 remount key 需包含语言码（约束 #40：Streamdown memoization 不追踪 props 变化）。
- 缓存更新：翻译成功后直接以响应更新 React Query 消息缓存（不整列表 refetch）。
- i18n：`Chat.Actions.translate`、`Chat.Translation.*` 等少量文案，中英文两份。

## 兼容性与回滚

- 新列 nullable，老消息 `translations` 为 null，UI 不渲染译文块。
- 回滚 = revert 代码；遗留 jsonb 数据无害。

## 测试要点

- 单元：语言常量；metadata schema 扩展；菜单渲染（user/assistant）。
- 集成：`/api/translate` 归属校验、缓存命中不重复调用模型、译文 merge 持久化（不覆盖其他语言）。
