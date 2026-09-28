# 聊天内图片编辑 — 执行计划

## 有序清单

1. **能力表**：`src/lib/image-capabilities.ts` 加 `imageInput` 字段 + 各家族初值（design §2 表）；更新 `image-capabilities.test.ts`（新字段解析、缺省=不支持）。
2. **后端适配器**：`src/server/ai/image/generate.ts`
   - `ImageGenParams` 加 `references?: GeneratedImage[]`；
   - google：parts 前置 inlineData；
   - openai-compatible：`openAiTransport` 分流（edits multipart / generations `image` data URL）；无 references 时逐字节不变；
   - `generate.test.ts` 补三个路径的 body 断言。
3. **route 旁路**：`src/app/api/chat/route.ts` 替换一刀切拒绝为分级校验（design §3.1），解析参考图字节并下传；`turn.ts` 透传 `references`。
4. **regenerate 分支**：从 `promptMessage` 的 file parts 解析参考图（design §3.4）。
5. **i18n key**：`messages/en.json` + `messages/zh-CN.json` 加 `image.tooManyReferences` / `image.referenceNotImage` / "编辑这张图" 按钮文案。
6. **Composer**：imageMode 按 `imageInputMax` 显示附件按钮/列表；`accept="image/*"`；image-only 过滤与 `min(5, imageInputMax)` 上限；imageMode 下 draft 必填。
7. **referenced attachment**：`composer-store.ts` `StagedAttachment.file` 放宽为可选；`use-composer-attachments` 的 `retryAttachment` 对无 `file` no-op；新增 `stageReference(draftKey, part)`。
8. **"编辑这张图"**：`ImagePreviewDialog` 加 `onEdit?`；`MessageItem` 对 image file part 接线（stageReference + 关对话框 + 聚焦 composer）。
9. **测试补齐**（见下）；本地 `pnpm test` 全绿。
10. **实证校准**（design §7 四项，需 zzx 的可用渠道）：校准能力表初值与错误文案。

## 校验命令

```bash
pnpm test                                           # 全量
pnpm test src/lib/image-capabilities.test.ts src/server/ai/image/generate.test.ts src/app/api/chat/route.test.tsx 2>/dev/null || true
pnpm lint && pnpm build                             # lint + 构建
```

## 测试要求

- `image-capabilities.test.ts`：`imageInput` 各家族命中、缺省不支持、规则优先级不被新字段破坏。
- `generate.test.ts`：google inlineData parts 顺序与 base64；edits multipart 字段集；generations-param 的 `image` data URL；无 references 时 body 与现状一致。
- `api/chat/route.test.ts`：三条新 400（不支持/超上限/非图像）先于 topic 创建；带参考图成功路径；字节解析调用链。
- regenerate `route.test.ts`：参考图从源 user 消息复解；源消息参考图已删 → 报错。
- `use-composer-attachments` / Composer 测试：imageMode 附件按钮显隐、accept 过滤、上限、draft 必填。
- `ImagePreviewDialog`/`MessageItem` 测试：onEdit 渲染与 stageReference 调用。

## 风险点 / 回滚点

- **multipart transport 是新代码**：fetch + FormData 在 Node 22 原生可用，但网关对 multipart 字段名（`image[]` vs `image`）的容忍度需实证——实现时以 OpenAI 官方 SDK 的字段形状为准。
- **Seedream data URL**：若上游只接受公网 URL，退路是仍用 data URL 报 400 透传并在能力表将该家族 imageInput 置空（回退最小）。
- 全部改动为增量；回滚 = git revert，无数据迁移。

## task.py start 前检查

- [ ] prd.md 收敛版通过（无遗留 TBD/Open Questions）
- [ ] design.md / implement.md 已评审
- [ ] implement.jsonl / check.jsonl 已配置真实 spec 条目
- [ ] 用户明确批准最终规划摘要
