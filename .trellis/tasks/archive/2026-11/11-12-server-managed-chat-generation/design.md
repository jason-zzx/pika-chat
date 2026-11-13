# 技术设计：服务端托管生成与响应恢复

状态：in_progress；本轮精简与后续 Ponytail 收敛已获批准、实施并完成独立检查。第10节是本轮变更设计，覆盖旧章节中的正常停机信号接管及 SSE 存续鉴权要求；其余既有行为不变。代码与 `.trellis/spec/backend/chat-generation-lifecycle.md` 已同步，验证与交付摘要见 `implement.md` 第11–13节；浏览器手测及提交/归档仍待用户。

需求唯一来源：`prd.md`。证据：`research/open-source-generation-lifecycle.md`、`research/sdk-upgrade-decision.md`。本文替代此前跨实例/PG流批次方案；研究文件中的旧方案仅保留为审阅记录，不作为实现要求。

## 1. 收敛后的决定

| 保留/采用 | 不采用 |
| --- | --- |
| 单个常驻Node应用进程独立生成，PostgreSQL保存任务与消息 | 跨实例接管、Redis、独立Worker、通用job框架 |
| 内存只维护当前完整消息状态 | 历史快照数组、原始增量事件日志、PG流批次表 |
| 在线推新增量；重连发送当前状态的恢复前缀，再接新增量 | 每次输出都广播全文、为重连保存从头至今的每个chunk |
| 现有POST SSE、useChat、Chat池和regen定位逻辑 | HTTP 202改造、全面重写前端状态、SDK截断式regenerate |
| 接受/终态持久化；低频检查点仅服务故障保留 | 每500ms全文落库、依赖数据库中转实时输出 |
| 同话题单活跃回合，不同话题独立启动 | 全站/进程/账号固定生成名额 |
| 启动时收尾上次进程遗留任务 | 分布式lease、心跳、远端取消与流补读 |

生产者不归HTTP连接所有。切换话题、刷新、关闭网页、退出只结束订阅，显式停止或删除才取消生成。进程丢失不重发已开始的模型/工具调用。单实例不是单用户或单并发。

## 2. SDK基线与恢复依据

正式实施首先精确升级`ai: 7.0.85 → 7.0.170`、`@ai-sdk/react: 4.0.88 → 4.0.174`及必要传递依赖。其他provider adapters、Next、React不批量更新，不启用experimental_queue/WebSocket/workflow。

已运行的隔离实验分两次：

- 旧版完成流重放会把中段assistant追加到末尾，产生重复ID；候选版按ID原位更新并保留后续消息。
- 本轮最小G1用真实候选`Chat`/`DefaultChatTransport`和本地HTTP：只持有当前`ABC`，通过标准UIMessage片段初始化恢复，暂停后继续发送`D`，结果为`ABCD`。重复恢复不增加消息；活跃reasoning、半截工具参数及metadata可以接续。

G1已回答SDK接回同一活跃消息的协议疑点，不代表业务链路或浏览器已通过验收。项目lint/typecheck/test/build留在正式升级时，实际UI交互由用户手测。实验命令与边界见`research/sdk-upgrade-decision.md`。

**当前状态不等于裸正文或单纯setMessages。**SDK需要text/reasoning起始标识及工具输入上下文，才能消费后续delta。服务端保留当前parts、metadata、活跃part标识和未完成工具参数原文；恢复时转成标准UIMessage前缀。无需原始事件日志，也不修改SDK私有状态。

## 3. 数据与内存职责

### chat_generations：一次已接受生成

| 字段组 | 内容 |
| --- | --- |
| 身份 | id、userId、requestId、requestHash、requestExpiresAt、kind(send/regenerate/edit) |
| 关联 | topicId、assistantMessageId；目标删除时清关联 |
| 状态 | queued/running/stopping/completed/stopped/failed/interrupted、targetDeletedAt |
| 输入 | 已验证请求、固定历史版本ID、system prompt/summary、模型选项、locale/timeZone、标题上下文；无明文凭证、文件二进制或临时签名URL |
| 时间 | createdAt/updatedAt/startedAt/finishedAt |

唯一索引`(userId,requestId)`；`topicId WHERE status IN (queued,running,stopping)`部分唯一；queued及终态回执清理索引。用户查询始终在WHERE限制userId。不加ownerToken、leaseExpiresAt、persistedSeq或流批次表。

`chat_messages`是已持久化正文的权威：接受时预分配assistant ID、空parts/outcome=null；regen继承groupId/groupCreatedAt并原子切换选中版本。检查点与终态更新同一行，不再次append。补nullable totalTokens/finishReason；中断使用failed+明确原因，不扩展旧outcome枚举。

### 进程内活跃任务

按generation ID保存任务、AbortController、当前消息、活跃流标识与订阅者。每个任务只保留一份持续更新的当前状态，不累积历史快照或历史chunks。工具输入原文也是当前状态，例如半截JSON，不能用解析后的对象代替它再接剩余字符。

在线订阅者收到新chunk；没有订阅者时仍更新当前消息，但不为将来的连接保存这些chunk。新订阅可为本次交接捕获一个稳定状态副本；这是连接时的临时读取，不是每个订阅者永久维护一份历史。正常完成持久化后释放活跃状态，后来连接读history，不设置5分钟流缓存保留期。

### 持久化节奏

- 接受事务保存任务、user/edit消息与assistant占位。
- 实时恢复直接读内存，不等数据库检查点，也不写逐token日志。
- 中途检查点仅用于进程故障时保留部分回答：采用低频、合并保存，初始内部间隔10秒，仅有变化时写入。它不是实时恢复的延迟、生成时长或并发限制，不增加配置项；不再由G1评估保存策略。
- 每任务最多一个检查点写入在途，期间合并为最新待存状态；流消费不await数据库写入。单次检查点失败不取消模型，后续保存仍可继续。
- 完成、停止、失败及正常关机保存最新内容与状态；终态提交前先结束该任务的检查点写入，避免旧内容覆盖终态。保存失败不能向客户端宣称已完成落库。

只承诺故障后保留已持久化内容；强杀可能丢失尚未保存的尾部，甚至尚未到首次检查点的全部本轮正文。低频保存仍有全文写入成本，不宣称彻底消除了写放大。

## 4. 原子接受、身份与回执

1. route鉴权/Zod校验；新客户端每次用户动作携带requestId，相同动作重试复用。旧客户端缺省时服务端生成，仍返回原SSE，不维护第二套运行模式。
2. 先按userId+requestId查回执：相同输入跟随同一任务，不重复模型调用；不同摘要409；已删除目标410。
3. 模型、目标/压缩区、附件能力与归属、图片参数验证先于业务写入；保留不支持附件时零消息写入合同。
4. 短事务写新话题（如需）、user/edit版本、assistant占位及queued任务。topic互斥与唯一索引兜住跨标签页竞争，事务内不做模型/存储/压缩网络调用。
5. 提交后立即唤醒本进程执行，不等周期扫描或订阅者；POST附着同一任务SSE。响应丢失不撤销已提交任务。

复用实际需要的message事务函数，不引入repository框架。账号隔离sessionStorage只保存尚未确认的requestId，不保存prompt；重载先查询任务，不自动重POST。退出清掉这些ID。

### 已定案的回执规则（G2）

这是已接受请求的去重/定位记录，不是SSE恢复缓存。浏览器重连始终GET，不重POST。

- 新客户端使用UUIDv7，时间嵌入ID。入口验证一次；以数据库时间为准，新key窗口为过去24小时至未来5分钟，requestExpiresAt固定为ID时间+24小时。
- **先查已有回执，再判新key期限。**同输入返回既有任务，活跃超过24小时也不受影响；不同输入409，已删除目标410。无回执且过期/过度超前，在任何业务写入/provider调用前拒绝。
- 活跃记录不因期限删除。终态记录在`max(finishedAt + 24小时, requestExpiresAt)`后自动清理，不提前删除仍可被当成新key接受的记录。
- 终态立即清input；requestHash保留到回执清理。删除目标立即清input/hash/内容关联，仅保留userId、requestId、expiresAt、删除标记和必要任务状态，到期自动清理。
- 回执清理后同一旧ID依然过期，不能重建任务或删除的话题。改UUID时间是另一个key，不是相同请求重试。
- 旧客户端缺省ID时保留原提交行为，不承诺新增去重。时钟错误的预写入拒绝响应给出serverTime，供后续显式新动作校准；不自动换key重发当前请求，不要求调整系统时钟。
- 活跃期及终态后至少24小时可凭requestId找回身份；到期后历史仍长期可读，但不承诺无限期通过旧requestId查询身份。

默认值由应用自动维护，无新增管理设置。期限/删除/确认丢失等规则在正式admission测试验证，不再设独立规划研究门禁。

## 5. 单进程执行与终态

Node instrumentation启动执行器，build不调度，测试显式启动，开发HMR不重复初始化。启动恢复在接纳新任务前完成：上次进程遗留的running标interrupted、stopping标stopped，保留已保存内容；queued可继续执行。不需要租约等待或跨实例owner判定。

- queued用数据库条件更新为running后执行；同一进程的重复唤醒也不能重复调用模型。正常提交立即唤醒；启动及维护时补捞queued，无固定生成名额。
- 服务端独立持有SDK消费链，浏览器取消仅退订。当前消息由一条组装路径维护；不要保留原route的完整消息组装后又叠一层相同解析，不留下无人读取的tee分支。
- 使用SDK公开协议/消费能力；只保留最新消息，不收集每次产生的快照。不为省复制预建另一套通用工具/消息解析器。
- 完成/停止/失败由执行器统一收尾：先保存最终/部分消息与任务状态，再发布终止通知。SDK回调不另行append或重复收尾。

| 事件 | 转换 |
| --- | --- |
| 接受/开始 | 无→queued→running |
| 完成/失败 | running→completed/failed，保存最终/部分正文 |
| 停止未开始 | queued→stopped，不调用模型 |
| 停止执行中 | running→stopping→stopped，abort后保存partial |
| 新版进程重启 | 遗留running→interrupted；stopping→stopped，保留已保存内容 |
| 删除 | 删除标记/清关联并取消本地生成；迟到输出丢弃，已产生文件按原规则清理 |

终态不回到queued。running即使可能尚未真正发出provider请求，进程丢失也不重投，避免重复推理/工具副作用。消息时间沿用Node应用时钟。

## 6. HTTP与恢复交接

| 接口 | 合同 |
| --- | --- |
| POST /api/chat | 原body加可选requestId；仍200 UIMessage SSE，data-topic保持；header带稳定generation身份 |
| POST .../messages/[messageId]/regenerate | 原body/edit加可选requestId；仍200 UIMessage SSE，不添加data-topic；保留x-pika-stream-id |
| GET /api/chat/generations?active=true | 当前账号活跃任务轻量列表，无其他话题正文 |
| GET /api/chat/generations?requestId=... | 找回身份；与active查询互斥；未找到404、目标已删除410 |
| GET /api/chat/generations/[id]/stream | 活跃则当前状态恢复前缀+后续增量；已终态204，客户端refetch history；已删除410 |
| POST /api/chat/stop | 保留{streamId}字段，值为持久化generation ID；鉴权后幂等停止 |
| 原history GET | 保持响应形状，返回所选版本及已持久化内容；活跃任务最新内容由stream恢复 |

不新增全文checkpoint详情接口。history与轻量任务发现可并行，seed完成后再恢复；prepareReconnectToStreamRequest直接指向任务stream端点。新动态路由使用requireParam，支持cookie/bearer。

### 当前状态接上增量

生产者先更新当前状态，再发布对应chunk；状态更新与订阅登记在同一顺序处理路径内协调，不能用尚未组装完的旧状态作为恢复基线。

1. 鉴权与查任务完成后，在同一进程内同步捕获当前消息/活跃标识并登记订阅，中间不await，避免遗漏这两步之间的输出。
2. 该订阅先发送从捕获状态生成的标准UIMessage前缀：稳定message ID/metadata、已有parts内容，以及尚未结束的text/reasoning/tool对应起始状态。已有`ABC`可以是一个text-delta，不需还原曾经的A/B/C拆分。
3. 前缀之后按订阅顺序发送新chunk；活跃part沿用相同ID。连接写队列中的短暂待发送数据不作为可重放的历史存档，也不写数据库。
4. 终止通知保持相同发送顺序；若查询时任务已结束，直接204并刷新最终history。删除标记拒绝新的内容订阅。

这是对当前状态的SDK协议适配，不是通用patch协议或SDK私有状态注入。当前项目实际使用的text/reasoning/tool/source/file/data/metadata纳入适配，未使用的SDK能力不预建支持。

### 客户端与连接边界

- 用候选SDK的`resumeStreamIsReplay: true`重建目标回答，按稳定ID原位替换，不把当前前缀追加在旧partial后面，不截断后续消息。
- 恢复只更新UI，不执行模型/工具；data-topic等副作用按任务身份处理，标题移到服务端。
- 请求断开只退订；stop先请求服务端取消，再停止本地读取。401/403/410停止恢复，网络错误不标服务端任务失败、不重新POST。
- 每次连接鉴权；沿用规划中的存续会话核实，失效只关闭订阅，不取消任务。不扩展成全站会话轮询系统。
- 慢订阅积压时只结束该订阅，不无限累积待发内容、不取消生成或影响其他订阅，不增加无限自动重连框架。此项沿用AC7，作为实施细节处理，不另设G1研究。
- 保留健康的SPA池订阅；不为恢复功能在每次切话题时强制断开。恢复前缀的显示过渡、滚动及真实网络体验由用户手测，不宣称最小SDK实验已经覆盖DOM。

## 7. 现有生成链与前端最小改动

### 后端

- generation-turn承接两条route共享执行；保留stream-failure、markup过滤、buildChatInstructions、reasoning timer、ignoreIncompleteToolCalls和现有maxRetries，不改变provider选取。
- 固定历史版本，禁止assistant占位混入模型上下文；自动压缩只看原前置历史，summary边界不变。
- search/fetchPage、压缩、图片与标题接收任务signal并组合现有timeout；显式取消不触发备用搜索或压缩降级继续工作。
- 图片函数与Response解耦，维持整批成功提交；停止/删除/失败/终态拒绝保存时清理本轮已上传文件，强杀遗漏复用orphan回收。
- locale/timeZone在入口捕获，后台不调用request-scoped cookies/translations。标题服务端best-effort触发，保留手动改名保护，不阻塞主回复，不依赖浏览器onFinish。

### 前端

- 保留useChat、chat-pool和regen的replace-in-place/insert-after函数。池维护已附着任务与订阅，但任务身份/生成中/停止能力以服务端为准，不再依赖ChatView局部regen生命周期。
- 普通发送沿用POST；regen首次消费沿用现有路径，恢复交给SDK按ID更新。不调用会truncate后续消息的SDK regenerate替代版本逻辑。
- Query负责持久历史/任务查询，Chat负责实时显示；不新增Zustand消息镜像。订阅前seed、终态后canonical reseed，迟到history不覆盖live消息。
- 共享API/query keys放中立目录并按userId隔离。活跃查询在进入/聚焦/重连/提交/停止时刷新；仅已知活跃且可见时周期刷新，隐藏空闲页不高频轮询。聚焦刷新history/detail/tree以发现离线完成的响应与标题。
- SDK可见性恢复与应用发现去重，同一任务一个恢复入口在途。保持50ms UI合并、memo、稳定引用、groupId键与触屏/滚动合同。
- 两个signOut入口成功后整页replace('/sign-in')，销毁旧QueryClient/池/上传回调；失败不伪装退出。Better Auth确认注销或userId变化使用同样边界，loading/离线不清空；账号无关设置保留。

## 8. 修改、删除与并发

发送/regen/edit/删消息/切选中版本/手动压缩在topic锁下检查活跃任务，有则409；标题/收藏不锁住生成。这一跨标签页/API约束已经用户批准，不同话题不共享生成名额。

删除topic/assistant与admission采用固定父→子锁顺序。检查点不独占父级资源；终态写入与删除通过任务状态/目标存在性及事务锁协调，不能重新插入被删消息。finalize先提交则删除随后清除；删除先提交则finalize放弃写入并清本轮文件。

删除事务写目标删除标记、清任务输入/内容关联并删除消息资源；事务后立即abort本地任务并清内存内容，不再设置远端控制扫描。标题任务也观察删除。各条服务入口实施时用集成测试验证，而非扩大G1。

## 9. 发布、回滚与门禁

- additive迁移只新增任务表、nullable消息metadata列及必要索引，不新增流批次表、不改旧outcome enum；沿用Docker自动迁移，无人工启用/清理配置。
- 保留POST/history/stop形状；旧网页不具备恢复UI，但普通提交/停止不被202协议变更破坏。不为旧客户端补通用兼容层。
- 正常关机停止接纳执行，取消并尝试保存partial/中断；强杀后新版启动自动收尾，不重调provider。终态回执自动到期清理。
- 回滚保留新增表与已保存消息，不要求手工SQL转换。强杀后直接运行不认识任务表的旧二进制，不能保证自动标记中断；不为该降级场景新增常驻兼容框架。
- G0：正式升级时运行项目lint/typecheck/test/build。
- G1：SDK能否从当前状态接回同一活跃消息并继续增量，且不重复追加消息。最小隔离实验已通过；不包括DB/WAL、GC、缓存释放、慢订阅预算或跨实例实验。
- G2：已定案请求去重规则，在正式admission测试覆盖。
- G3：实施后验证启动/关机/重启收尾与核心数据一致性；实际浏览器功能回归交用户手测。

实施已完成上述SDK升级及业务接入；G0/G2/G3自动检查与真实进程/OCI容器验证汇总见 `implement.md` 第11–13节，落地合同见 `.trellis/spec/backend/chat-generation-lifecycle.md`。未落库尾部、永久写故障、旧二进制降级和实际浏览器未验边界仍保留，不将自动门禁等同于完整产品验收。

## 10. 本轮精简设计（已批准实施）

需求来源为 PRD 的 SC1–SC7。用户已分别确认 A/B 行为缩减；以下不新增产品选项、部署组件、数据库迁移或依赖升级。

### 10.1 接受入口与可信写入边界（SC2/SC3）

- 保留 `admitTurn` 为生产接受入口：先查询已有回执，再对新 key 校验一次时间窗，然后调用准备函数完成模型/附件与资源归属预检。将已算出的 expiry 传给内部接受逻辑，删除第二轮锁外查询/时钟验证。将 `acceptTurn` 收为模块私有，相关集成测试改经唯一入口，不保留仅供旧测试继续调用的兼容入口。
- 事务内已有话题的回执竞争检查保留；新话题并发依靠唯一键及冲突后读取赢家回执，仍保留 payload 冲突与目标删除语义。TTL、数据库时钟、hash、清理策略都不变。
- `prepareSendTurn` 的 assistant/topic 归属查询与 `prepareRegenerateTurn` 的 topic context 查询是 admission 的授权边界；删除 `acceptTurn` 重复 assistant 查询。topic 行锁只负责串行化，不当作授权证据；现有冻结检查保持，不趁机重写上下文一致性。
- 公共 `appendUserMessage`、`appendUserMessageVersion`、`appendAssistantMessage`、`insertAssistantPlaceholder` 保留自己的归属保护，包括外部传入 tx 的调用。其底层写入可与已授权 admission 复用：在同一 message.service.ts 内拆出最多两个实际共用的 user/user-version 写入函数，并复用已有 `insertAssistantRow`。底层函数显式接收数据库执行器与已准备的消息数据，不接收 skipAuth/authorized 布尔开关，不接收 HTTP 输入；只有公共鉴权包装与 admission 调用，路由不得直接引用。
- 这是现有两条调用路径之间的写入复用，不新增 repository、权限 token/品牌类型或通用授权框架，不复制 SQL。必要的 group 角色/位置读取及事务原子性保留，不把业务查询当冗余鉴权删掉。权限反例继续在公共服务与实际准备入口验证，不能通过删掉断言换绿。

### 10.2 执行与客户端死状态（SC1/SC4）

- `runGenerationTurn` 将已解析的 selected/handle 传入 runTextTurn；准备阶段与后台执行阶段的解析仍分开，压缩模型选择不变。不引入新的模型解析缓存或对象工厂。
- 删除 ChatPoolSendContext、entry.sendContext、相关 pick 参数和 import；noteSendStarted 保留 sidebar 即时标记，ChatView 和测试同步调用。服务端标题、池迁移、重连字段、消息 UI 均不改。

### 10.3 不再接管框架退出（A、SC6）

- 删除 `generation-shutdown.ts`、`scripts/dev.mjs`；package.json 的 dev 恢复 `next dev`。instrumentation 继续启动 runner，只移除信号注册与 stopGenerationRunner 的启动侧 import。
- 删除专用于旧信号接管的 generation-shutdown.test.ts、next-signal-child.cjs、next-dev-signal-parent.cjs，不保留不可达测试夹具。
- `stopGenerationRunner` 目前还被两份集成测试用于资源清理和直接停止验证，保留该显式 API 及其相关实现；没有框架 hook 后不能再描述为生产进程必经路径。不顺带重写 runner 的 shutdown/终态重试内部状态机。
- 不添加替代信号监听器、不拦截 process.exit、不增加运维环境变量。生产正常停机依赖已有持久化内容；新版启动继续收尾 running/stopping 并补捞 queued，已开始任务不重新推理。
- 不承诺尾部损失上限；检查点失败或首个检查点前退出可能没有本轮正文。数据库暂时写不进去时，仍不伪造完成信号。

### 10.4 连接建立时鉴权（B、SC7）

- 删除 session-guard.ts 及专用测试；respondWithGeneration 直接将 subscription.stream 交给 SSE 编码，不新增包装流。移除 isSessionValid 参数及 send/regenerate/resume 三个路由的回调和 resolveActor import。
- 三个路由仍调用 requireActor，respondWithGeneration 仍按 actor 查询 generation；stop、history、active/requestId 查询的授权不变。
- 已建立连接不再主动核实会话撤销；会话失效后的新请求/重连被拒绝。AccountProvider 和显式退出的页面销毁仍保留，但不宣称它们等价于服务端撤销保障。
- 底层 subscription 的 cancel 与有界队列保留；删除包装后验证浏览器断开仍只退订、不取消生产者，慢订阅仍不拖累其他连接。

### 10.5 兼容、范围与回退

- POST SSE、恢复 GET、消息/版本/metadata、回执与停止 API 的形状不变；只减少用户已批准的停机保存和既有连接撤销保证。不新增客户端配置。
- 权限写入复用需要少量有实际复用方的函数边界，其他部分以删除为主；新增通用抽象或显著扩大范围必须重新审阅。
- 不实施永久终态写错时丢正文降级、不删 pending receipts、不改 queued sweep、不修上下文前缀检查。相关疑点保持明确，不宣称本轮解决所有已知问题。
- 无 schema 回滚；各组可独立撤回本轮补丁，不能回滚用户此前94项工作区改动。提交/归档须另行授权。
