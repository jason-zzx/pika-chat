# 执行计划：服务端托管生成与响应恢复

状态：第0–11节记录既往实施与检查。用户已批准本轮第12节的最终规划，指定 `jason/gemini-4-hydrogen` 实施、完成后由当前主会话模型检查。原有单实例、内存当前状态、POST SSE/useChat/池复用继续保持；只执行本轮精简，不重做历史阶段。提交和归档仍未授权。

## 0. 证据与开始条件

- [x] 核查现有send/regen/edit/image/title/compression/search、归属和metadata链路。
- [x] LibreChat/Open WebUI/AI SDK固定源码研究；用户确认同话题跨标签页/API互斥。
- [x] 用户确认不考虑跨实例，内存保存当前完整状态，不保存历史快照数组或原始增量日志。
- [x] SDK确定为ai7.0.170/react4.0.174；隔离实验确认按ID修复中段恢复重复消息，实施首轮已更新项目依赖。
- [x] 最小G1：当前状态恢复前缀接后续实时增量，真实SDK可原位接回活跃消息；重复恢复不新增消息。结果见research/sdk-upgrade-decision.md。
- [x] 删除跨实例/PG批次、远端补读、lease/heartbeat和宽泛性能实验要求。
- [x] G2已定案：UUIDv7固定24小时窗口/5分钟未来容差，先查已有回执，到期清理后旧key仍被拒绝；活跃长任务/聊天历史不受24小时限制。
- [x] 用户已审阅本版最终摘要并明确批准实施，允许运行task.py start。

G0/G3是实施期质量检查。首轮及第二轮拒绝通过的历史记录保留在第9/10节；最终状态见第11–13节。下方实施/自动验证勾选已依据复查恢复，不代表用户浏览器验收完成；PRD完整AC保持待确认。

### G1唯一问题与已运行的最小验证

**问题：**AI SDK能否通过当前消息状态构造的恢复流，接回同一条仍在生成的回答，继续接收输出，而不是重复追加消息？

实际运行：

```sh
node /tmp/pika-sdk-version-review/current-state-probe.mjs
```

原型使用真实候选Chat/DefaultChatTransport与本地HTTP/SSE，不调用真实provider/DB/storage。只持有当前`ABC`、当前reasoning及半截工具参数；未保存A/B/C原始事件。客户端收到恢复前缀后由可控信号暂停，再发送`D`和剩余reasoning/tool增量。相同中段消息恢复两次。

通过断言：恢复前缀为ABC且status=streaming；接续后正文ABCD；工具半截JSON继续解析为完整参数并接收结果；reasoning/metadata保留；消息ID列表始终为`[answer,later-user,later-answer]`；后续答案不变，文本part不重复，结束status=ready。

这只证明SDK协议接入可行，不证明应用端状态捕获/订阅实现、终态事务、删除竞争或真实DOM体验已完成。G1到此结束，不增加缓存释放、DB写量/WAL、CPU/GC、缓冲预算、慢订阅或多进程基准。不因实施期仍需普通验证而重新打开规划研究门禁。

## 1. 必要SDK升级（G0）

- [x] 精确更新package.json的ai至7.0.170、@ai-sdk/react至4.0.174，由pnpm更新lockfile及必要传递依赖。
- [x] 保留provider adapters、Next/React版本；不增加Redis/resumable-stream/experimental_queue/WebSocket。
- [x] 跑既有lint/typecheck/unit/integration/build，核对provider、UIMessage流、useChat池/节流、错误/onEnd合同。
- [x] 将本次最小恢复断言纳入现有测试结构，覆盖中段稳定ID、当前状态接续、metadata/tool/reasoning，不建设独立测试框架。

回退点：依赖差异可独立撤回；若出现广泛破坏，停在G0评估，不叠加功能或扩大重构。

## 2. 数据与原子接受

- [x] 新增generation schema及导出；chat仅补nullable totalTokens/finishReason，旧outcome enum不变；生成迁移。不建流批次表或分布式租约字段。
- [x] 共享schema定义任务身份/status/查询模式；send/regen可选requestId，stop保留streamId字段并映射generation ID。
- [x] generation.service负责接受、条件开始、检查点/终态、任务查询及G2回执清理；服务层WHERE限制userId。
- [x] topic级互斥+部分唯一索引，预定assistant ID、group锚点/选中版本，send/edit与queued同事务；仅提取真正复用的message事务能力。
- [x] 模型/附件/压缩区/图片输入失败零消息写入，事务不执行外部网络操作。
- [x] 隔离DB验证空库/升级、幂等/同key改输入、确认丢失、过期/删除回执、同话题冲突、不同话题并行和唯一选中版本。

检查点：先确定任务/消息身份再执行模型；历史API形状不变。

## 3. 独立生产者与当前状态恢复

- [x] Node instrumentation启动单进程runner，build不调度/HMR不重复；启动先收尾遗留running/stopping，再调度queued及接纳新任务。
- [x] 提交后即时唤醒，queued条件开始防重复；启动/维护补捞未开始任务，不设全局/账号并发名额。
- [x] generation-turn承接现有生成逻辑，服务端独立消费；浏览器cancel不传播到生产者，只维护当前消息，不累积历史快照/增量日志，不重复组装完整消息。
- [x] generation-stream从当前parts/metadata及活跃标识构造标准SDK恢复前缀，再接新chunk；状态捕获与登记订阅之间无await。不操作SDK私有状态，不预建通用codec。
- [x] 接受/终态必须保存；故障保留用低频合并检查点（初值10秒且有变化才写），实时恢复不等检查点。每任务一个写入在途，消费循环不await DB，单次检查点失败不取消生成。
- [x] 终态先结束检查点写入、再保存最新消息/状态并发布结束，防旧保存覆盖终态；成功后释放活跃状态，后来连接读history。不设置历史流缓存保留期。
- [x] 用现有测试结构验证无浏览器仍完成、不同话题可并行、重复唤醒不重调provider、普通断连不取消、重启不重投已开始任务及低频保存/终态顺序。

检查点：当前状态是恢复来源，DB不是实时中转；G1已经解决的SDK疑点不扩展成专项性能研究。

## 4. 业务副作用、接口与删除

- [x] 图片执行与Response解耦，整批提交/失败清文件不变；删除/finalize竞争清本轮新图片。
- [x] 标题移到服务端best-effort，后台使用入口locale/timeZone。search/fetchPage、压缩、图片、标题继承取消，显式取消不降级继续工作。
- [x] 两条POST保持200 UIMessage SSE、data-topic行为、x-pika-stream-id及原错误形状；新增轻量列表/requestId查询与恢复GET。无全文任务详情接口；终态204后刷新history。
- [x] stop按任务授权并标stopping，立即取消本地生成；topic/assistant删除清内容并立即取消，不保留远端控制轮询。
- [x] 删除与admission/finalize保持锁顺序，迟到结果不得重建数据；消息删选版本/手动压缩活跃时409，标题/收藏可操作。
- [x] 核对连接/存续授权、cookie/bearer及账号隔离；鉴权失效仅关订阅。
- [x] 移除withDisconnectAbort旧绑定，stream-registry不再充当唯一身份/授权来源；不保留双运行模式。

检查点：删除不能复活数据；最终内容持久化成功后才发布完成。

## 5. 前端局部接入

- [x] 中立API/query keys按userId隔离，保留useChat、chat-pool、regen定位及历史消费。
- [x] ChatView局部regen/streamId权威迁到任务信息/池，切走回来仍能发现并停止；不全面重写ChatView或复制消息到Zustand。
- [x] DefaultChatTransport接恢复GET，使用resumeStreamIsReplay；按message ID原位恢复，不调用截断式SDK regenerate。
- [x] 协调regen原消费路径、pool/useChat及可见性恢复；保留健康SPA连接，网络断开不标服务端失败、不重POST。
- [x] 订阅前seed，迟到history不覆盖live状态，终态后canonical reseed；保留后续消息/版本/压缩边界。
- [x] active查询以事件触发为主，仅已知活跃且页面可见时轮询；聚焦刷新history/detail/tree。
- [x] 两处退出成功整页跳转；确认账号切换销毁旧文档，离线/loading不误清，待确认requestId按账号保存并在退出清除。
- [x] 补必要中英文状态文案；代码层保留50ms合并、memo、稳定引用、groupId键及现有滚动机制。实际触屏/滚动交互由用户手测。

## 6. 实施期验证与分工

| 对应验收 | 验证内容与承担方 |
| --- | --- |
| AC1/2 | 代理检查同generation/message身份、模型只调用一次和回执；用户手测send/regen/edit × 切换/刷新/关闭/退出重登 |
| AC3 | 代理检查服务端授权隔离；用户手测两处退出、A→B、跨标签页和迟到上传 |
| AC4/5 | 代理检查queued/running stop、删除/finalize两种顺序、G2重放、同话题互斥与不同话题并行 |
| AC6 | 代理检查SDK协议/metadata/版本数据；用户手测图片/搜索/压缩/标题及中段恢复、显示过渡、滚动/触屏 |
| AC7 | 代理检查Node启动、build不调度、至少5话题可开始、正常提交不等扫描、状态/回执正常释放；不设专项性能门禁 |
| AC8 | 代理检查正常关机/强杀后新版收尾、保存顺序、保留已存partial、不重投已开始任务 |

正式执行命令：

```sh
pnpm lint
pnpm typecheck
pnpm exec vitest run --project unit-node --project unit-dom
pnpm exec vitest run --project integration
pnpm build
python3 .trellis/scripts/task.py validate .trellis/tasks/11-12-server-managed-chat-generation
```

集成仅使用隔离TEST_DATABASE_URL和InMemoryFileStorage；受控本地模型统计实际HTTP调用，不访问真实付费provider或用户S3。复用既有测试结构，不另建内存/DB/GC压测工程。

交付给用户简短手测清单并标明尚未手测项；自动检查通过不等于用户交互验收完成。用户手测不再作为规划阶段阻塞项。

## 7. 影响范围与复杂度预算

| 部分 | 拟影响位置 | 当前粗估 |
| --- | --- | --- |
| 依赖 | package.json/pnpm-lock.yaml | 2个直接依赖，锁文件按必要变化 |
| 数据/服务 | generation schema、chat metadata、generation.service、message事务函数 | 约400–650行新增/实质改动，不含迁移 |
| 执行/恢复 | runner/turn/stream、instrumentation、image/search/compression/title | 约500–850行，含route逻辑搬移和当前状态协议适配 |
| HTTP/删除 | 两条POST、stop、任务GET、相关删除/上下文服务 | 约250–450行 |
| 前端/账号 | ChatView局部、pool/regen/Bridge、中立API、退出入口、i18n | 约350–600行，不改消息渲染层架构 |

约1500–2550行新增/实质改动，约25–35个业务文件，为当前规划粗估而非新增代码目标。已删流批次表、持久序号、跨实例读取、租约心跳及配套清理；仍需当前状态到标准UIMessage的有限适配，不把这部分说成零成本。实施若出现需要额外抽象或显著超出范围的变化，先说明而非自行扩张。

## 8. 发布与收尾

- [x] G3检查启动、正常关机与容器grace period、强杀后新版自动标中断；无新服务/配置开关，任务回执自动维护。
- [x] 升级/回滚保持旧消息enum和POST/history/stop形状，无手工SQL转换；明确旧二进制不具备新任务收尾能力。
- [x] 主会话更新已落地的backend/frontend相关spec；规划阶段不把未来设计写成现行事实。
- [x] 自动检查结果及用户手测范围已整理至第11节；提交和归档等待明确授权。保留用户AGENTS.md及验证报告改动。

## 9. 首轮检查与返修

首轮实施由tokenrhythm/deepseek-v4.1-flash-1017执行，独立检查由jason/gpt-6-astra执行。检查结果：不通过业务验收。主会话抽查确认编辑上下文重复、自动压缩自冲突、停止在claim期间的遗漏、账号query key缺失及pending请求工具未接入等问题；不将这些缺口转为用户手测项。

已有基础：SDK升级、generation表/迁移、占位与任务服务、独立生产者/订阅、部分前端发现与显式退出。检查直接修复健康流1024增量截断、退出错误返回误判、服务端spinner残留，并增加7项回归。

首轮检查命令：lint/typecheck、unit 1216项、integration 232项、build、task validate、diff check均通过；只能证明当前覆盖范围。被迁移业务的执行器/turn测试缺失，G3未完成；此前大面积完成勾选已撤回。

返修仍在原批准范围，按依赖串行实施：①B1/B2生命周期与原子终态；②B5/B6/B7/B8接受、上下文、副作用及实际执行测试；③B3/B4前端恢复/账号与B5请求凭条闭环；然后由当前模型全范围复查。不得恢复旧G1压测、增加框架或删减行为测试来换取全绿。子代理不得编辑规划或spec，由主会话核对完成情况。

## 10. 第二轮检查：仅余B1/B2阻断（历史，后续闭环见第11节）

三阶段返修及独立复查已结束。B3–B8通过本轮代码核对，但不代表用户UI验收完成；B1/B2仍不通过，不恢复相应完成勾选。

- B1：真实Next 16.3.3 startServer与项目shutdown hook组合实验复现SIGTERM后保存已开始但300ms保存未完成，Next以143退出。在途claim尚未注册live时也未被stopGenerationRunner等待。实验位于/tmp/pika-recheck/next-signal-probe.cjs，只证明框架退出竞争，不冒称完整Docker/DB G3。
- B2：终态事务失败后仍关闭订阅、删除live entry并markSettled，DB保持running；现有扫描只处理queued。需保留待保存的最新终态内容并在同进程自动收尾，不能重调模型、误发finish或要求用户手动stop/重启。图片在最终裁决前不能错误删除。
- 本轮实际自动检查：lint/typecheck通过；unit 1280项、integration 277项通过；build通过但有3条instrumentation Edge API警告；diff check通过。集成使用隔离测试DB、本地provider及InMemoryFileStorage。

下一步仅返修以上两个已复现问题及必要回归，再由当前模型独立验证修复和关联行为。保持零用户配置、单实例、原HTTP/SDK协议，不引入新队列/通用重试框架。启动/信号组合需以真实Next验证；最终写失败需做受控故障注入，不能只测helper。完整部署G3和迁移验证仍需如实记录。

## 11. 最终专项复查与交付状态

指定实施模型完成B1/B2返修后，jason/gpt-6-astra独立复查又修复4处问题：dev父进程100ms强杀、webpack Edge分支误编译Node依赖、阻塞claim拖住其他live保存、提交确认丢失后stopped/failed缺终止信号。B3–B8结论沿用第二轮检查，未借专项复查声称重新全面审计。

| 项目 | 最终状态/证据 |
| --- | --- |
| lint/typecheck | 通过 |
| unit-node + unit-dom | 145文件/1283项通过（最终独立全量） |
| integration | 24文件/290项通过；隔离测试库、内存存储、本地provider |
| 生产/原Dockerfile构建 | 通过，0条Edge API/Runtime警告；构建不调度runner |
| G3正常停机 | 原OCI镜像默认docker stop、next start、项目dev的Turbopack/webpack入口均观察到保存后退出；无模型重调 |
| G3强杀重启 | 真实10秒检查点后SIGKILL；新版启动标interrupted，保存正文等于杀前检查点，provider调用数不增加 |
| 迁移 | 原镜像空库自动迁移26项；0024→0025旧消息旧列不变、enum不变、新列null、重复迁移幂等 |
| 规范 | 新增backend/chat-generation-lifecycle.md并同步metadata、versions、compression、image、error-handling、frontend状态规范 |
| 未授权动作 | 无提交、暂存、推送、归档；task保持in_progress |

证据目录 `/tmp/pika-verify-terminal/`。父会话抽查最终代码、unit/integration摘要、container-final.log与migration.log；文档更新后再运行task validate/diff check。

**明确未验/残余项：**
- 用户手测：send/regen/edit的切走返回、刷新/关闭重开、两处退出及同账号重登；跨标签页账号切换与迟到上传；中段版本/图片/搜索/压缩/标题的真实显示；触屏与滚动。自动测试不替代这些验收，PRD AC不代勾。
- 一次unit与其他门禁并行时，既有ChatView-pool reconnect用例超时；未修改该B3用例，独立全量重跑通过，波动根因未查清。保留测试稳定性跟进，不扩展本轮重构。
- OCI验证使用Podman的docker CLI；未启动用户整套Compose/RustFS/反向代理或旧版本二进制。回滚为保留新增schema的additive合同，不存在需要执行的down迁移。
- 强杀/外部期限提前只保证已存检查点；永久终态写故障保留live并仅重试持久化，话题仍占用直到成功或进程退出。裸next dev绕过项目脚本不享有自动父进程宽限。

实现和自动验证已交付；等待用户手测反馈以及单独的提交/归档授权。

## 12. 本轮精简执行计划（已批准实施）

对应 PRD SC1–SC7 与 design 第10节。用户已审阅最终摘要并明确批准实施，指定 `jason/gemini-4-hydrogen` 实施、当前主会话模型检查。以下完成标记来自本轮独立检查与实跑证据，不借用第11节历史记录。

### 12.1 顺序与局部检查

1. [x] 清理纯局部冗余（SC1/SC4）：generation-turn 传递模型解析结果；chat-pool/ChatView 删除 sendContext 及调用参数；更新既有测试，先跑相关 unit 与实际生成集成用例。
2. [x] 收敛 admission（SC2/SC3）：admitTurn 一次锁外回执/窗口校验，acceptTurn 私有；保留锁内及唯一键竞争检查。公共消息服务保留鉴权，底层写入与可信 admission 复用，不用 tx/skipAuth 绕过公共入口。迁移直接 acceptTurn 的测试到唯一入口，核对真实跨账号准备失败、同 key 并发、新旧话题、预检零写入及中段 regenerate/edit 版本断言。
3. [x] 删除框架退出接管（A/SC6）：删除 generation-shutdown.ts、scripts/dev.mjs，修改 instrumentation/package.json，删除对应旧 hook 测试及两个独占 fixture。保留显式 stopGenerationRunner 的测试清理用途及启动恢复；更新注释，不能再将直接调用停止 API 的测试称为 Next 自然退出测试。
4. [x] 删除周期会话核实（B/SC7）：删除 session-guard.ts/专用测试；generation-response 直接使用底层订阅；三条路由删除 continuation 回调。更新 generation-response 和路由测试，只撤销周期鉴权断言，不减少连接建立/恢复/停止的账号与归属断言；检查真实订阅取消与慢读队列行为。
5. [x] 验证新合同并同步受影响 spec：优先在既有集成文件补充必要断言，不造测试框架；主会话同步生命周期 spec 和确有影响的鉴权/错误说明，过去 review 文档不改写。运行全量门禁并报告剩余手测范围。

### 12.2 验证矩阵

| 验收 | 自动验证与证据 |
| --- | --- |
| SC1/SC4 | generation-execution.integration、chat-pool、ChatView、ChatView-pool：模型选择、编辑上下文一次、group身份、draft迁移、发送标记、恢复与后台完成；只对去重次数用最小已有测试桩，其余优先实际执行。 |
| SC2 | generation.service.integration：收据先于prepare、过期/超前key、payload冲突、目标删除、同key并发（既有与新话题）、回执清理；不因私有化acceptTurn而删行为用例。 |
| SC3 | message.service unit/integration 保留公共函数跨账号拒绝（含传tx）；实际prepare/admit或路由链路拒绝其他账号的assistant/topic。可信底层写入无路由直接调用；所有版本写入仍在同一事务。 |
| SC6 | 保留checkpoint/boot/queued断言；隔离库和本地provider启动真实Next进程，等待可观测检查点成功后SIGTERM并重启，确认保存内容仍在、running→interrupted、provider调用数不增加。另覆盖首次checkpoint前退出（允许空placeholder）、stopping→stopped、queued补捞；启动恢复中的这些状态可复用既有集成测试，不必每个都建独立进程工程。检查pnpm dev及pnpm start正常启动退出。 |
| SC7 | 使用实际会话的受控失效：已有订阅继续接收同一任务输出，新POST/恢复GET拒绝；账号B不能订阅A。正常cancel仅移除订阅不abort模型，有界队列仍限制慢读者。复用generation-response/registry及真实DB集成环境；不访问生产鉴权服务。 |
| SC5 | lint/typecheck/unit/integration/build、任务context校验及diff检查；无新增迁移/依赖/部署配置。 |

SC6 的进程实验只证明新停机合同，不要求复现已撤销的“退出前最新尾部必保存”；SC7 不等待真实60秒定时器。浏览器send/regen/edit刷新关闭、两处退出、触屏滚动仍按原约定交用户手测，不假称通过。

### 12.3 正式门禁

```sh
pnpm lint
pnpm typecheck
pnpm exec vitest run --project unit-node --project unit-dom
pnpm exec vitest run --project integration
pnpm build
python3 .trellis/scripts/task.py validate .trellis/tasks/11-12-server-managed-chat-generation
git diff --check
```

集成与进程实验仅隔离 TEST_DATABASE_URL、本地受控provider、InMemoryFileStorage；未确认环境隔离前不运行DB测试。任一门禁失败保持未完成并报告，不用旧全绿记录或删除无关用例代替。

### 12.4 影响预算与边界

- 约14–15个业务/配置文件（含删除3个生产文件、必要runner注释），约150–250行实质编辑及185行生产文件删除；为规划粗估，不要求为了达到行数目标增加重构。
- 另删除2个专用测试文件和2个独占信号fixture，当前合计400行；调整约8–12个已有测试文件，主要为admission入口迁移和新行为断言。总计可直接删除的7个文件当前585行。
- 消息服务最多新增两个实际共用的底层写入函数，并复用现有assistant写入函数；公开服务仍鉴权，不新增生产模块、通用权限对象或兼容API。若实际需要更大分层，暂停该项重新审阅。
- 每组修改独立检查；回退只撤销本轮对应补丁，不执行全工作区reset/checkout，不覆盖用户改动。
- 不改变persistTerminal重试、冻结上下文校验、receipt协议、AccountProvider及queued扫描。没有新的配置开关，未批准任何提交、推送或归档。

### 12.5 规划门禁状态

- [x] 两项产品取舍确认并写入PRD；收敛需求、设计、执行计划及源码证据。
- [x] 用户在本轮最终规划摘要后明确批准实施，并指定实施模型及后续检查分工。
- [x] 第12.1–12.3节实施与验证完成。

### 12.6 本轮交付

- 实施：`jason/gemini-4-hydrogen`；独立检查与局部修正：当前主会话 `jason/gpt-6-astra`。
- 28个代码/配置/测试文件发生变化（含删除7个），新增648行、删除913行，净减265行。
- 检查移除了不可达的事务备用分支和重复的强制类型转换测试桩，保留真实DB的传tx鉴权覆盖；会话撤销测试改走真实HTTP响应路径。
- 主会话最终lint/typecheck、unit串行全量143文件/1276项、integration 24文件/294项、build通过。默认并行unit曾复现既有reconnect用例波动，未宣称修复；完整失败/通过日志见报告。
- 真实 `pnpm start` 验证检查点后/首检查点前SIGTERM重启，真实 `pnpm dev` 验证检查点后SIGTERM重启；保存内容不变、状态正确中断、模型不重调。dev副本首次被pnpm依赖校验拦截，补验通过；临时环境已清理。
- spec已同步；浏览器手测不代勾，未提交、暂存、推送或归档。

## 13. Ponytail追加精简（实施与独立检查完成）

本轮只验证并执行以下7条行为不变的建议；不重新执行第12节，不恢复已撤销的信号接管/周期鉴权。若源码或实测证明建议不成立，则保留原实现并报告原因，不以行数目标强删。

- [x] P1：subscribeToGeneration直接返回ReadableStream，移除无人消费的GenerationSubscription.close及包装状态；保留cancel退订、慢订阅隔离及完成时关闭。
- [x] P2：确认abortLiveGeneration/abortLiveGenerationsForTopic无调用者后删除，不改真实stop/delete路径。
- [x] P3：以TanStack Query原生focus/visibility及默认后台禁轮询替代useActiveGenerations手写监听；只在有活跃任务时轮询，保留enabled与账号边界，实际测试隐藏→可见恢复和禁用查询不发请求。
- [x] P4：chat-pool只保留generationId，删除同值streamId及同步helper，迁移停止入口/测试；HTTP streamId字段及regen局部协议不改，保留draft迁移与断线恢复。
- [x] P5：AccountProvider使用已类型化的session.error?.status，删除unknown重验helper；401/离线/加载中及账号切换行为不改。
- [x] P6：用final.outcome替代恒等terminalStatusOf函数及专用import，终态裁决逻辑不变。
- [x] P7：pending receipts只存userId/requestId，删除只写的topicId/createdAt及调用参数；GET恢复、去重、退出清理、账号隔离不变，不引入旧存储迁移层。

预估涉及7个核心生产模块及直接调用点/已有测试，净减约110行生产代码；无新依赖、配置、业务层或行为取舍。实施前记录当前工作树快照以区分本轮与既有未提交工作。实施和检查串行、一名写者；子代理不改spec/任务文档/AGENTS/既有验证报告，不提交、暂存、推送或归档。

验证：针对订阅/registry、pool/ChatView、active查询、AccountProvider及pending receipts运行既有测试并更新必要断言；保留回归覆盖而非删除测试换绿。lint/typecheck、unit全量及使用隔离TEST_DATABASE_URL/InMemoryFileStorage/本地provider的相关生成集成测试；独立检查再核对完整本轮diff及构建，失败如实记录。UI仍由用户手测，不扩大为性能/内存压测。

### 13.1 本轮结果

- P1–P7全部成立并实施；独立检查无需再修代码。
- 相对 `/tmp/pika-ponytail-baseline`：8个生产文件净减108行（+18/-126）；10个测试文件净增92行；合计18文件净减16行。新增3项原生Query可见性/禁用回归，未删原有测试场景。
- 独立检查实跑：lint/typecheck通过；默认并行unit 143文件/1279项通过；相关generation integration 3文件/76项通过；`DOCKER_BUILD=1 pnpm build`通过。未重跑全量集成、OCI构建、进程重启或浏览器验收，不复用历史通过记录冒充本轮结果。
- 首次unit因DB设为不可达地址导致既有env.test.ts启动用例超时（1278通过/1失败）；该用例真实启动runner，依赖DB。改用迁移完毕且无generation任务的隔离DB后，原用例37项及全量1279项均通过，未改测试以消除失败。既有reconnect波动本轮未复现，不宣称修复。
- 两阶段测试均采用临时PostgreSQL、本地provider、InMemoryFileStorage，测试容器已删除，未访问生产服务。生命周期spec已同步；浏览器手测仍归用户，未提交、暂存、推送或归档。

