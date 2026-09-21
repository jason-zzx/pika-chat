# Implement — 聊天内生图功能

执行顺序按依赖排列；每步附验证。验证命令（仓库根目录）：

```bash
pnpm vitest run <path>          # 单测
pnpm tsc --noEmit               # 类型检查（若 scripts 有 lint/typecheck 以其为准）
pnpm eslint <path>
```

## Step 1 — 能力表 `src/lib/image-capabilities.ts`

- `ImageSizeMode` / `ImageModelCapability` 类型 + 初始能力表（gpt-image 系、dall-e-3、dall-e-2、gemini image 系、seedream 系、qwen-image/wanx 系）+ `DEFAULT_IMAGE_CAPABILITY`。
- `imageCapabilityFor(modelId)`：末段小写匹配，表序即优先级。
- 测试 `image-capabilities.test.ts`：各家族命中、大小写/前缀变体、未知模型落默认。
- ✅ `pnpm vitest run src/lib/image-capabilities.test.ts`

## Step 2 — 后端 image service `src/server/ai/image/`

- `generate.ts`：`generateImageForEndpoint` + `Record<ProviderApiFormat, Adapter | null>`（claude: null）。
  - openai-compatible：`/images/generations`，b64_json 优先、url 兜底下载；`AbortSignal.any([requestSignal, timeout(120s)])`。
  - google：`generateContent` + `responseModalities` + `imageConfig`；inlineData/text 解析；可选字段一律 `.nullish()`。
- `normalize.ts`：ImageGenParams → 厂商 payload（aspect-ratio / openai-size / freeform 三种 sizeMode 映射）。
- 错误映射走 `provider-error.ts` 既有约定，400 参数错误的合法值列表允许透传。
- 测试：mock fetch 覆盖两个格式的请求体形状、b64/url 两种响应、Gemini inlineData+text 混合、超时/abort、错误状态映射。
- ✅ `pnpm vitest run src/server/ai/image/`

## Step 3 — 请求 schema + `/api/chat` 旁路

- `src/lib/schemas/chat.ts`：`chatRequestSchema` / `regenerateMessageRequestSchema` 加 optional `image: { size?, n?, quality? }`；assistant file part 无需新 schema（复用 `chatFilePartSchema`）。
- `route.ts`：`requireModelForActor` 后分支（design §3 顺序：先能力判定，再话题创建，保证不落地脏草稿）：
  - claude + image → 400 `model.imageUnsupported`
  - 带 file part → 400 `image.attachmentUnsupported`
  - 能力表校验参数（非法档位 400，freeform 自定义透传）
  - 生成 → file.service 落库 → appendAssistantMessage → `createUIMessageStream` 单消息响应
- 失败路径：failed outcome assistant 消息 + errorMessage。
- `title.service.ts`：兜底 pair 对应模型 `outputModalities` 含 `image` 时跳过 LLM 直接用文本截断标题（短路必败调用）；显式 title 偏好不拦。
- 测试 `route.test.ts`：分支判定、三种 400、成功路径消息形态、失败落库。
- ✅ `pnpm vitest run src/app/api/chat/route.test.ts`

## Step 4 — regenerate 旁路

- `regenerate/route.ts` 同样分支，走版本组既有机制。
- 测试：生图消息 regenerate 产生新版本、isSelected 切换。
- ✅ `pnpm vitest run src/app/api/topics/[id]/messages/[messageId]/regenerate/route.test.ts`

## Step 5 — 前端 composer 生图模式

- 选中模型 outputModalities 含 image 时：隐藏 reasoning/search/附件，显示参数弹层（尺寸/数量/质量，按 `imageCapabilityFor`），请求体带 `image`。
- 停止按钮 → abort fetch。
- model pick 加 image 标识（badge）。
- MessageList：确认/放开 assistant 图片 file part 的内联渲染。
- i18n：`image.*` 键，en + zh-CN。
- ✅ `pnpm tsc --noEmit` + 相关组件测试 + 手工验证（两个 format 各跑一次真实出图）

## Step 6 — 回归验证

- 普通聊天模型：流式、搜索、附件、压缩、标题、翻译全过一遍（跑既有测试套件 + 手工冒烟）。
- ✅ 全量 `pnpm vitest run` + lint/typecheck

## Review gates

- Step 2 完成后：自查 provider-error / .nullish() / 穷举键三个 spec 要点。
- Step 4 完成后：跑 trellis-check 全量（spec 合规 + 跨层数据流 + 复用检查）。

## Rollback points

- Step 1–2 纯新增，随时可弃。
- Step 3 起改动聊天路由：任一步出问题 revert 到上一绿点即可，无数据迁移。
