# 消息翻译

## Goal

在消息下方操作区（`src/components/chat/MessageActions.tsx`）增加翻译图标，点击后从常用语言菜单中选择一种目标语言，对该条用户提问或助手回复进行翻译并展示译文。用户价值：跨语言交流时无需复制到外部翻译工具。

## Confirmed Facts（代码勘察）

- 操作区组件 `MessageActions.tsx` 已有 DropdownMenu 模式（复制 / 重新生成 / 版本切换），翻译入口按此扩展。
- 触摸设备约束：hover-only 交互禁止（约束 #15）；Base UI Select/Popover 的 modal 行为需注意（约束 #16）。
- 一次性 LLM 调用范式：`src/server/services/title.service.ts`（`generateText` + `createChatModelHandle`），翻译 API 路由可复用。
- 消息渲染：`MessageItem.tsx` + `Markdown.tsx`（Streamdown，memoization 约束 #40：动态内容需通过 remount key 强制重解析）。

## Requirements

- R1 **翻译通道**：复用当前会话的聊天模型。新增 `/api/translate` 路由，服务端以 `generateText` + 当前会话模型做一次性非流式翻译（提示词要求只输出译文），零配置。
- R2 操作区翻译图标对 user 与 assistant 消息均可用。
- R3 **语言列表**：固定 8 种常用语言（简体中文、English、日本語、한국어、Français、Deutsch、Español、Русский），菜单项显示各语言本地名称；原文语言由模型自动检测；不做原文语言排除——若原文语言即目标语言，原样返回。
- R4 **译文持久化**：翻译结果写入该消息版本的 metadata（`translations: { <lang>: <text> }`），刷新/换设备后仍在，不重复消耗 token。

## Acceptance Criteria

- [x] AC1：user 与 assistant 消息操作区均显示翻译图标，点击展开 8 种语言菜单（各项显示本地名称）。
- [x] AC2：选择语言后译文出现在消息正文下方（含语言标签），markdown 结构保留。
- [x] AC3：原文语言与目标语言相同时原样返回，不报错。
- [x] AC4：译文持久化——刷新页面后译文仍在；同一消息同一语言重复翻译命中缓存，不重复调用模型。
- [x] AC5：不同消息版本的译文互相独立（版本切换不串译文）。
- [x] AC6：触摸设备上翻译菜单可正常打开/选择/关闭（无 hover-only 依赖）。
- [x] AC7：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿。
- [x] AC8（翻译进行中提示）：选择语言后译文位置立即出现闪动的"正在翻译为{目标语言}"提示（`role="status"` 可感知）；成功后提示被译文替换；失败时提示消失并弹出本地化错误。
- [x] AC9（折叠）：译文块可折叠/展开，折叠后隐藏正文、保留语言标签与展开控件；键盘与触摸均可操作；多个语言各自独立折叠。
- [x] AC10（引用渲染）：含 `[n]` 标记的助手消息被翻译后，译文中的标记渲染为可点击引用 chip（与正文一致），不出现字面 `[n]` 文本。

## Out of Scope

- 自动翻译整个话题。
- 输入框 Composer 内的实时翻译。
- 专用翻译服务（DeepL / Google Translate 等）接入。

