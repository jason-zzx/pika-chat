# 开源项目：关闭网页后的生成与恢复

后续决策：用户已授权必要依赖升级并确认仅单实例、内存维护当前完整消息。`sdk-upgrade-decision.md`记录新版修复中段重复消息，以及当前状态恢复前缀接活跃增量的最小G1通过；当前合同以`../design.md`/`../implement.md`为准，不再采用PG流批次或历史增量日志。本文“本地版本不支持”是研究时的事实，不是禁止升级；外部项目的重放存储/跨实例能力不等于本项目必须照搬。

## 范围与证据等级

用户已确认：同一话题单活跃回合约束可覆盖跨标签页/API，不限制不同话题并行。要求先研究类似项目，避免方案继续扩大。

本轮直接读取GitHub官方仓库源码并固定提交，同时读取AI SDK官方文档。搜索工具因认证不可用未取得搜索结果；不将搜索失败或模板名称作为功能证据。没有启动这些项目，没有做关闭网页/退出账号的端到端实测。以下是指定路径的源码结论，不是所有provider/工具/部署模式的兼容承诺。

| 项目 | 固定提交 | 检查范围 |
| --- | --- | --- |
| LibreChat | `e6567c7a681ce67869dce31486a21d3a25d6931b` | agents聊天入口、GenerationJobManager、SSE路由、内存/Redis服务工厂 |
| Open WebUI | `b0e6098e940942281d9c83f3529ea117287a3a22` | 带session_id/chat_id的后台聊天路径、tasks、socket断开、历史读取、流消费与最终保存 |
| Vercel AI SDK | `2ebc78b65435926718879f85a1a85687b053c542` | 官方resume文档、examples/next的POST/恢复GET/停止DELETE |
| Vercel chatbot | `a8989b522fa3672a2ae52f053105e40993b36ca1` | POST、恢复GET、use-auto-resume；作为“有接口不代表闭环”的反例 |

下载的阅读副本在 `/tmp/pika-generation-references/`，仅方便本轮源码定位；持久证据使用下面的固定提交链接，不依赖临时目录。

## 1. LibreChat：后台生成 + 独立SSE + 恢复状态后继续增量

### 实际流程

1. agents request入口创建job，向客户端返回JSON `{streamId, conversationId, generationCreatedAt, status:'started'}`；该路径HTTP是200，不是202。
2. `void startGeneration()`独立启动生成。代码明确说明不等待SSE订阅者就绪，事件在订阅附着前有缓冲/状态记录。
3. GET `/chat/stream/:streamId`鉴权后订阅SSE；连接close只中断attachment并unsubscribe，不在此取消生成。
4. 重连调用`subscribeWithResume`：获取恢复状态，捕获快照与订阅附着间的增量，实时交付先暂停；路由发送`sync/resumeState/pendingEvents`后才`subscription.activate()`。这正是需要验证的无缝交接，不是重复调用模型。
5. 所有订阅者离开时有partial snapshot保存路径；完成/停止另有最终保存协调。不能把“无人订阅”当作生成失败。
6. 显式abort路由调用`abortJob`，并在发布结束事件前协调partial保存；断连和停止是不同操作。

### 部署边界与不可照搬部分

- `createStreamServices`支持内存job store/event transport；Redis可选，并非关闭网页继续生成就必须安装Redis。
- Redis分支解决共享状态/跨实例事件，不等于能续接进程已丢失的供应商网络连接。
- 项目还包含多租户、HITL、定时任务、queued turns、steering等；本轮获取的GenerationJobManager约一万行。不能为了本功能复制其通用框架。
- 它有独立的用户pending-request限制以及内存job存储容量/过期配置。这些是该产品的容量策略，不是恢复的必要条件，更不能用来为Pika并发4背书。

### 固定证据

- [request.js L1870-L1904：JSON回执、断连不abort、无人订阅时保存partial](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/api/server/controllers/agents/request.js#L1870-L1904)
- [request.js L2299：立即后台生成；L3494调用](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/api/server/controllers/agents/request.js#L2299)
- [routes/agents/index.js L181-L239：SSE与close解绑、归属检查](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/api/server/routes/agents/index.js#L181-L239)
- [routes/agents/index.js L354-L384：sync之后activate](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/api/server/routes/agents/index.js#L354-L384)
- [GenerationJobManager.ts L6230：subscribeWithResume的快照/附着间隙处理](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/stream/GenerationJobManager.ts#L6230)
- [createStreamServices.ts：内存/Redis选择与内存保留配置](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/stream/createStreamServices.ts)
- [request.js L1530：独立用户并发策略](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/api/server/controllers/agents/request.js#L1530)

## 2. Open WebUI：后台asyncio任务 + Socket.IO增量 + 查询覆盖实时状态

### 实际流程

1. 有session_id/chat_id的正常聊天路径用`create_task(...process_chat...)`启动独立asyncio任务，返回`task_ids/chat_id`；没有这些metadata的legacy/direct路径仍同步处理，不能笼统称所有API都会后台执行。
2. `tasks.py:create_task`直接`asyncio.create_task(coroutine)`，保存任务引用、结束后清理；无需独立worker部署。
3. Socket.IO的disconnect清会话/房间/在线使用记录，未在此取消普通chat生成任务。
4. 内容流通过`response:completion`等事件增量发送；也有完整状态事件用于阶段/恢复，不是每个字都向浏览器重发全文。
5. 生成中维护`response_streams`。无Redis时在进程内；Redis路径用snapshot+delta累积，超过相对snapshot大小的阈值再写新snapshot。
6. GET chat读取持久化历史后，用当前`response_streams`覆盖相应message的实时内容；回来时可得到正在生成的部分，不仅是最后一次完成的数据库历史。
7. 被检查的delta路径最终将完整输出写DB；取消捕获`CancelledError`后保存partial。其正常路径不要求每token写历史表。
8. 单独的chat stop接口查归属、查task IDs并取消任务，且有处理失去活动task的消息收尾逻辑。

### 部署边界与不可照搬部分

- 无Redis也有后台执行路径；Redis用于跨实例任务控制、心跳/TTL与共享实时状态。
- 无Redis的进行中快照在内存，进程崩溃不能由它保证partial持久恢复。Pika若保留“服务器丢失时恢复最近保存内容”的AC8，仍需自己的持久化checkpoint；不能因Open WebUI最终保存就删除该要求。
- Socket.IO是该项目已有基础设施，不是我们必须引入的技术。SSE同样可以订阅服务端生产者。
- 此处确认的是控制流，不把历史覆盖与socket事件间的所有竞争都宣称已端到端证明；客户端工具/临时聊天也不能等同普通已保存聊天。

### 固定证据

- [main.py L1845-L1950：后台创建、返回task IDs及legacy分支](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/main.py#L1845-L1950)
- [tasks.py L160-L182：asyncio任务持有及清理](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/tasks.py#L160-L182)
- [tasks.py L202-L295：内存/Redis进行中状态及snapshot/delta加载](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/tasks.py#L202-L295)
- [socket/main.py L1421-L1445：断连只清会话/房间](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/socket/main.py#L1421-L1445)
- [routers/chats.py L1455-L1482：读历史后覆盖当前流状态](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/chats.py#L1455-L1482)
- [middleware.py L4708-L4740：snapshot/delta压缩机制](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/utils/middleware.py#L4708-L4740)
- [middleware.py L6518-L6602：最终/取消partial落库](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/utils/middleware.py#L6518-L6602)
- [main.py L2259-L2282：独立chat stop](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/main.py#L2259-L2282)

## 3. AI SDK官方示例：保留useChat/POST流，外接可恢复流存储

- 官方方案用`consumeSseStream`把流交给`resumable-stream`独立消费；保存`activeStreamId`，GET恢复当前流。
- `useChat({resume:true})`继续使用现有消费层。POST仍返回UIMessage SSE，不必改成202+新hook。
- 示例用Redis作恢复流存储；`waitUntil: after`承接响应后工作。这不是承诺任意serverless环境无限执行，也不是模型进程重启后的推理续传。
- 显式stop与HTTP断开分开。固定的examples/next有DELETE写`canceledAt`，生成端用独立AbortController观察它；这种onChunk检查方式在长时间没有chunk时可能延迟取消，不能直接照搬。
- 示例regenerate使用slice截掉后续消息，不符合Pika“不截断后续消息、版本组内替换”的合同。
- 官方网页的stop示例允许客户端上送partial；Pika有服务端权威消息，不应因此改成信任客户端覆盖正文。

### 版本差异必须保留

本地`ai@7.0.85` / `@ai-sdk/react@4.0.88`已有`ChatTransport.reconnectToStream`和mount时resume。当前官方网页还描述`resumeStreamIsReplay`和visibility重连；本地相应源码未发现这些选项/逻辑，不能直接使用网页最新API，更不能暗中升级SDK来让方案成立。页面刷新后恢复active text/reasoning内部状态仍是本地实验门禁。

### 固定证据

- [官方说明](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- [固定文档源码](https://github.com/vercel/ai/blob/2ebc78b65435926718879f85a1a85687b053c542/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx)
- [examples/next POST：独立stop signal与consumeSseStream](https://github.com/vercel/ai/blob/2ebc78b65435926718879f85a1a85687b053c542/examples/next/app/api/chat/route.ts#L62-L108)
- [恢复GET与停止DELETE](https://github.com/vercel/ai/blob/2ebc78b65435926718879f85a1a85687b053c542/examples/next/app/api/chat/%5Bid%5D/stream/route.ts)

## 4. 反例：不要把Vercel chatbot模板的残留接口当完成功能

该固定提交的POST在配置REDIS_URL时仍创建resumable stream，但GET `/api/chat/[id]/stream`只有：

```ts
export function GET() {
  return new Response(null, { status: 204 });
}
```

因此不能引用这个提交证明“该模板已完整实现刷新恢复”，也不能把SDK官方examples/next与独立chatbot仓库混为一谈。

- [chatbot恢复GET](https://github.com/vercel/chatbot/blob/a8989b522fa3672a2ae52f053105e40993b36ca1/app/(chat)/api/chat/%5Bid%5D/stream/route.ts)
- [chatbot POST L405-L426](https://github.com/vercel/chatbot/blob/a8989b522fa3672a2ae52f053105e40993b36ca1/app/(chat)/api/chat/route.ts#L405-L426)

## 5. 对Pika的结论：借鉴边界，不复制平台

### 有直接证据支持的最小公共结构

```text
提交 → 服务端持有的一次生成 → 服务端保存结果
                    ├─ 当前页面订阅增量
                    ├─ 页面断开：仅取消订阅
                    ├─ 重新进入：找同一任务、恢复状态、继续订阅
                    └─ 显式停止/删除：取消生产者
```

1. 保留现有常驻Node与PostgreSQL，不因“后台”二字新增Redis、Socket.IO、独立worker或通用任务平台。
2. 保留现有UIMessage增量协议/useChat作为首选实验方向，普通发送POST不预先改202。重新生成的中段定位保持现有纯函数，不直接调用会截断消息的SDK regenerate示例。
3. 服务端状态负责generation/message身份与终态；页面订阅不拥有任务寿命。服务端周期checkpoint满足Pika特有的AC8，不把它与网络全量推送绑在一起。
4. 优先参考LibreChat的“暂停订阅→恢复基线→补齐间隙→放行实时”边界；验证本地SDK如何从parts恢复text/reasoning/tool解析状态。不能声称只加resume:true就完成。
5. 快照、实时增量与显式取消足以描述本功能核心；固定并发池、全面前端替换、全套分布式队列都不是这些案例证明的必要条件。已有任务原子领取/故障收尾需求应独立论证，不以外部框架有就照搬。
6. 研究不能替代Pika验收：关闭后重开、退出再登录、删除与落库竞争、账号隔离、本地SDK版本和慢客户端均需我们自己验证。

## 本轮规划影响

- 单话题跨标签页/API互斥已批准，不再询问。
- 前置实验优先级确定为“现有SDK/流合同最小接入 + 独立生产者 + 恢复交接”，不是先实施已撤回的202/新hook方案。
- 明确原始完整快照研究只是独立消费证据，不是传输协议或前端替换的定案。
- 任务仍planning。SDK接入实验、有界回执清理及自动关机/回滚收尾尚未通过；不扩大本轮到实现或引入依赖。
