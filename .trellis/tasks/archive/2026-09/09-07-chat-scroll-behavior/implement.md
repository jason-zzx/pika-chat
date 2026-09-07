# 执行计划（补写：已全部完成）

> 实现已在主会话直接完成并经浏览器实测。本文件回写执行步骤与验证记录。

## 实现清单

- [x] 1. `ChatView.tsx`：新增 `sendSignal` 计数器，`handleSend` bump，透传给 MessageList
- [x] 2. `MessageItem.tsx`：新增 `articleRef`（列表定位最新用户消息）与 `minHeight`（reserve 施加于流式回复 article）
- [x] 3. `MessageList.tsx` 发送定位：send effect 滚动新消息至视口顶部（`top - 16`，clamp 到可滚上限）
- [x] 4. `MessageList.tsx` reserve：流式回复 article `min-height = 容器高 − 消息高 − 48`；submitted 阶段用尾部 spacer 占位；流结束后保留，下次发送转移
- [x] 5. `MessageList.tsx` pin 模型：unpin 只由 `onWheel(deltaY<0)` / `onTouchMove` 用户手势触发；`handleScroll` 仅向下滚到底（<32px）时 re-pin
- [x] 6. **修复**：ResizeObserver effect 依赖 `[]` → `[hasMessages]`（首挂载 messages 为空导致 RO 永不连接的根因）
- [x] 7. **修正**：尾部固定 spacer → 回复 article min-height reserve（原方案回复一生长就把用户消息顶出视口）
- [x] 8. `MessageList.tsx` reserve 排干：回答结束后向上滚动等量缩减 reserve；同步直写 DOM（`spacerLeftRef` + `lastAssistantElRef`），耗尽时 `setSendTurn(null)`
- [x] 9. **修复抖动**：排干改直写 DOM（原 React state 回环晚一帧）；re-pin 限向下滚动（原向上也 re-pin 与 wheel 解 pin 打架，RO 写-读循环）
- [x] 10. `MessageList.tsx` 进入 topic 落底：一次性 entry effect（让行于 pending send / 流式）；RO 跟随条件加 `!streaming` 空闲态一支（mermaid/图片异步撑高保持吸底；中间消息 regen 不拽视图）

## 验证记录（admin + sensenova-6.8-flash-lite，真实流式）

| 验证项 | 方法 | 结果 |
|---|---|---|
| 发送置顶 | 采样 `msgTopInView` | 恒 16px ✓ |
| 流式吸底 | 采样 `scrollHeight - scrollTop` | 恒 = clientHeight(414) ✓ |
| 长思考跟随 | 100s 流式全程采样 | 持续跟随 ✓ |
| 上滚解 pin / 回底 re-pin | dispatch wheel + 改 scrollTop | 解 pin 后 h 增 top 不变；回底恢复 ✓ |
| reserve 排干 | 上滚 100px/400px | 282→182→0，缩减量=滚动量，距底不变 ✓ |
| 抖动 | scrollTop setter trap | 20 次上滚 0 次程序写回 ✓ |
| 进入 topic 落底 | 侧边栏导航 | top=1906=max ✓ |
| 异步渲染吸底 | 26 个 mermaid 图 topic，100ms 采样 | 高度波动 5 次全程 atBottom ✓ |
| 静态检查 | `tsc --noEmit` / `eslint` | ✓ |
| 单测 | `vitest run src/components/chat/` | 16 文件 115 测试全过 ✓ |

## 回滚点

- 三个文件 `git checkout -- src/components/chat/{ChatView,MessageItem,MessageList}.tsx` 即可整体回退；无数据/API 变更。

## 遗留 / 后续可选

- 键盘 PageUp 与拖动 scrollbar 向上不触发 unpin（沿用既有行为；RO 写回因 reserve 不变式基本为 no-op，极端场景可能有小幅拽回）。
- reserve 在回复内容矮于 reserve 时，排干末段（minHeight < 内容高）无视觉效果，属预期。
