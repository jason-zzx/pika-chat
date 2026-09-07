# 设计：聊天滚动行为

> 补写：实现完成后回写，记录最终落地的设计与调试中确认的关键事实。

## 总览

全部逻辑集中在 `MessageList.tsx`（滚动状态机），`ChatView.tsx` 只增加一个 `sendSignal` 计数器，`MessageItem.tsx` 增加两个透传 prop（`articleRef`、`minHeight`）。

```
ChatView ── sendSignal(n+1) ──▶ MessageList
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
  entry effect              send effect                  ResizeObserver
  (topic 进入落底)      (发送定位+开启 reserve)        (内容增长 → 跟随)
                                   │
        handleScroll / onWheel / onTouchMove（用户手势 → unpin / reserve 排干）
```

## 核心机制

### M1 发送信号（ChatView → MessageList）

`sendSignal` 是单调递增计数器，`handleSend` 中 bump。用计数器而非布尔值：同一 effect 依赖变化即触发，配合 `handledSendSignalRef` 去重。守卫容忍"信号"与"新消息入列"落在不同 commit（仅在见到未见的尾部 user 消息时动作）。

### M2 reserve 预留区（关键：钉住的是用户消息）

**曾走过的弯路**：初版在列表尾部放固定 spacer。回复每流出一个字总高度就增加，吸底逻辑立刻把用户消息顶出视口——视口顶部只剩 AI 回复。

**最终方案**：reserve 做成**流式回复 article 的 `min-height`**：

```
reserve = 容器高 − 用户消息高 − 48px   (48 = 容器纵向 padding 32 + 行 gap 16)
```

- 回复在预留区域内生长时**总高度不变** → 吸底不动 → 用户消息全程钉在视口顶部；
- 回复超过预留高度后，总高度才开始增长 → 自然过渡为跟随尾部；
- 回复尚未出现（submitted 阶段）时，用等高的尾部 spacer div 占位；
- 流式结束后 reserve **保留**（主流做法：最后一轮下方留空），下次发送时转移到新的一轮。

### M3 pin / unpin 模型

- `pinnedRef`：是否吸底。初始 true；**只**被用户手势解除——`onWheel(deltaY<0)` 与 `onTouchMove(手指下移)`。
- **绝不**在通用 `onScroll` 里按"距底部距离"解除 pin：发送定位是程序化滚动，会把 scrollTop 移离底部，若据此解除 pin，随后的流式跟随全部被吞（初版三个症状同源于此）。
- `handleScroll` 只在**向下滚动**到底（<32px）时 re-pin。向上滚动永不 re-pin——reserve 排干期间距底部距离恒为 ~0（设计使然），若向上也 re-pin，会与 wheel 解 pin 每帧打架，并喂给 ResizeObserver 形成写-读循环（抖动根因之二）。
- `followRef = tailStreaming || sendTurnActive`；RO 回调实际条件为 `pinned && (follow || !streaming)`：
  - `!streaming` 一支覆盖空闲态（进入 topic 后 mermaid/图片异步撑高时保持吸底）；
  - 中间消息重新生成（streaming 但非 tail）不满足条件 → 不拽视图（C3）。

### M4 reserve 排干（回答结束后向上滚动）

`handleScroll` 检测向上滚动增量（`prevScrollTopRef`），等量缩减 reserve：

- **同步直写 DOM**（`lastAssistantElRef.style.minHeight` + `spacerLeftRef`），**不经 React state**——状态回环晚一帧渲染，是抖动根因之一（C2）；
- 缩减量 == 滚动增量 → 距底部距离不变 → 可见内容零跳动，浏览器不会反向 clamp；
- 耗尽（=0）时才 `setSendTurn(null)` 做一次状态清理（移除 min-height prop、退出 sendTurn 跟随）；
- 仅在回答结束后（`!streaming` 且尾消息为 assistant）生效；触摸与滚轮都走 scroll 事件，移动端自动覆盖（C5）。

### M5 topic 进入落底

- 一次性 effect：消息首次出现（历史 seed）且**无未处理的 send 信号、非流式**时滚到底。
- **声明顺序敏感**：必须在 send effect 之前声明，使 guard 读到的是发送前的 `handledSendSignalRef`，否则草稿发送会被误判为"进入"而滚到底，覆盖发送定位。
- 流式守卫覆盖草稿发送后 replaceState 拿 topic id 的场景（C4）。
- App Router page 组件在动态段导航时重新挂载，因此每个 topic 进入都是新 MessageList 实例，无需额外 key。

### M6 ResizeObserver 的连接时机（本次最隐蔽的 bug）

RO effect 依赖 `[hasMessages]` 而非 `[]`：MessageList 首挂载时 `messages` 恒为空（历史话题挂载后才 seed、草稿本为空），走 empty 分支导致 `contentRef.current === null` → 若用 `[]` 则 effect bail 且**永不重试**，RO 从未连接——spacer 渲染了、初始滚动执行了，但后续所有跟随滚动失效。

## 数据流 / 状态表

| 状态 | pinned | follow 条件 | reserve | 视图行为 |
|---|---|---|---|---|
| 进入 topic | true | `!streaming` ✓ | 无 | 落底并保持吸底直到用户上滚 |
| 发送→submitted | true | sendTurn ✓ | 尾部 spacer | 用户消息置顶 |
| 流式（回复<reserve） | true | sendTurn ✓ | article min-height | 用户消息置顶，回复原位生长 |
| 流式（回复>reserve） | true | tailStreaming ✓ | 同上 | 跟随尾部下滚 |
| 流式中上滚 | **false** | — | 保持 | 自由阅读 |
| 结束后上滚 | false | — | 随滚动排干 | 正常上滚，无死区残留 |
| 回滚到底 | true（re-pin） | 恢复 | 剩余 reserve | 恢复吸底 |

## 已验证的边界

- 长思考（100s 流式）：reasoning 块增长驱动外容器跟随 ✓
- reserve 排干全程程序化 scrollTop 写回 = 0（无抖动）✓
- 含 26 个 mermaid 图的 topic：渲染波动 5 次全程吸底 ✓
- 再次发送：reserve 转移到新一轮，新消息精确置顶（msgTop=16px）✓

## 兼容性 / 回滚

纯前端交互层改动，无 API / schema / 存储变更。回滚 = revert 三个文件。`ResizeObserver` 不支持的浏览器直接跳过跟随（保留基础滚动）。
