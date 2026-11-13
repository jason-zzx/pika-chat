# SDK升级决策与最小重放实验

## 授权与范围

用户要求依据开源研究修订规划，并允许必要的相关依赖升级。本轮检查npm已发布包、在`/tmp`隔离安装候选版本并运行本地HTTP/SSE实验；未修改项目package.json/pnpm-lock.yaml，未调用真实模型、数据库或对象存储。依赖升级作为正式实现的第一项，不能把此实验当项目全量兼容测试。

## 版本与依据

| 包 | 当前 | 本轮确定的目标 |
| --- | --- | --- |
| ai | 7.0.85 | 7.0.170 |
| @ai-sdk/react | 4.0.88 | 4.0.174 |

来源：`https://registry.npmjs.org/ai`、`https://registry.npmjs.org/@ai-sdk%2freact`的latest元数据与对应tarball。react@4.0.174直接依赖ai@7.0.170，配对明确，不按major猜兼容性。目标均为本轮查到的稳定版本，不使用浮动latest、beta/canary。现有React 19.2.8符合其peer范围。

已发布ai包CHANGELOG：
- 7.0.134：恢复时保留provider-executed tool calls。
- 7.0.137：恢复读取时丢弃不相关消息状态。
- 7.0.138：重放防重复parts、按稳定message ID更新、页面重新可见时恢复；共享Chat仍在streaming时不重复mount恢复。
- 7.0.170/React 4.0.174包含这些修复；DefaultChatTransport公开resumeStreamIsReplay（默认true）。

只升级这两个直接依赖及包管理器解析出的必要传递依赖。provider adapters、Next、React、数据库库不因“可以升级”而顺带更新。现有openai-compatible是3.x，不能照spec概述误升到4.x；以实际依赖/类型兼容检查决定是否需要额外调整。若升级出现需要广泛业务迁移的破坏，停在依赖门禁报告，不自动扩展重构。

## 已运行实验

命令：

```sh
npm install --prefix /tmp/pika-sdk-version-review/runtime --ignore-scripts --no-audit --no-fund ai@7.0.170 @ai-sdk/react@4.0.174 react@19.2.8
node /tmp/pika-sdk-version-review/replay-probe.cjs
```

受控本地HTTP端点发送真实SDK UIMessage SSE：固定message ID、reasoning、工具input/output、正文与metadata。分别加载项目已安装版本和候选发布版本的真实`Chat`/`DefaultChatTransport`；从已有部分assistant消息恢复，同一流连续重放两次。

| 场景 | 当前版本 | 候选版本 |
| --- | --- | --- |
| 尾部assistant恢复两次 | 正文/思考/工具未重复 | 正文/思考/工具未重复 |
| 中段assistant之后还有user/assistant | **原位置仍为partial，末尾追加同ID answer** | **原位置更新，后续两条保留，ID不重复** |

实测IDs：当前中段为`[answer,later-user,later-answer,answer]`；候选为`[answer,later-user,later-answer]`。候选断言通过：text=`first second`，reasoning=`thinking`，一个output-available工具part，groupId保留，status=ready，后续答案内容不变。

因此升级不是为了追新：它直接修复本项目“中段重新生成后恢复”的位置问题，减少自写SDK恢复兼容逻辑。原始实验脚本仅在临时目录，正式实现时把同等用例纳入项目现有测试结构。

## 首轮实验未证明的内容（历史范围）

以下描述首轮完成流实验的边界，不是当前规划待办。跨实例和PG流批次已退出本期；活跃消息接续的最小疑点由下方追加实验覆盖，其他实现验证不扩展为G1。

- 这次是完成流重放，不是正在进行的快照/增量交接；没有验证中途工具参数恢复、断线瞬间、慢客户端、DOM是否闪退旧文本。
- 未测试PostgreSQL临时流批次、跨实例交接、终态/删除竞争、鉴权、图片或真实浏览器。
- 未跑项目lint/typecheck/test/build；这些必须在正式升级后通过，不能把隔离安装成功当兼容通过。
- 暂不启用新SDK的experimental_queue、WebSocket或workflow能力；同话题活跃时409的产品约束不变。

## 规划结论

正式实施先精确升级ai/react并通过现有质量门禁；保留useChat和POST SSE。当前设计使用当前消息状态生成SDK恢复前缀，再接新增量，不保留原始历史事件。任务仍planning，不因隔离实验通过自动开始实现。

## 追加最小G1：当前状态恢复后继续实时输出

用户收窄G1：只回答SDK能否接回同一活跃消息并继续输出、不重复追加消息；不追加内存/GC、数据库/WAL、缓存释放、慢订阅或跨实例基准。

### SDK源码约束

本轮检查候选发布包`ai/src/ui/chat.ts`与`ai/src/ui/process-ui-message-stream.ts`：

- `resumeStreamIsReplay`在恢复start处重置流状态，更新时按message ID替换已有消息。
- text/reasoning delta依赖对应start建立的活跃part映射。只setMessages已有正文再发送delta，并不能重建这些映射。
- 工具输入流需要当前未完成的原始参数串；候选SDK在`rawInput`保留该串。仅解析后的partial对象不能替代原文来接剩余JSON字符。

因此内存保存当前消息及必要活跃标识/工具原文；连接时生成标准start/text/reasoning/tool等片段初始化SDK。这不要求保存A/B/C原始事件，也不要求修改SDK内部私有状态。

### 运行与结果

```sh
node /tmp/pika-sdk-version-review/current-state-probe.mjs
```

使用真实`ai@7.0.170`/`@ai-sdk/react@4.0.174`，本地Node HTTP服务器与DefaultChatTransport，不使用真实模型、DB或storage。实验脚本位于临时目录，未加入业务代码。

服务器只持有当前`ABC`、reasoning=`thinking`、工具原文=`{"q":"a`及活跃标识；没有原始增量数组。以标准UIMessage片段发送当前状态，用transient探针通知客户端已消费前缀，然后等待测试端显式放行后续输出，不靠随机sleep。

| 断言 | 结果 |
| --- | --- |
| 恢复前缀已消费、流尚未结束 | 正文ABC，status=streaming |
| 继续原活跃text ID的D增量 | 正文ABCD，只有一个text part |
| 继续原活跃reasoning ID | thinking more，结束正常 |
| 半截工具参数继续收到`bc"}` | input为`{q: 'abc'}`，rawInput完整，之后正常接收工具结果 |
| 中段恢复，不动后续消息 | IDs为`[answer,later-user,later-answer]`，后续答案unchanged |
| metadata及结束状态 | groupId=group-1，status=ready |
| 同一目标再次恢复相同受控响应 | 两次GET均通过，不新增消息或重复text part |

**结论：最小G1通过。**当前状态生成的协议前缀可以接续活跃增量，不需原始事件日志。脚本是受控协议实验，重复GET不代表调用了两次真实模型；没有测试模型执行或持久化。

本实验不证明生产代码已实现无缝状态捕获/订阅、删除/终态事务、图片/引用等完整适配、浏览器无闪烁或项目兼容。这些分别属于实施期普通检查与用户手测，不是继续扩张G1的理由。
