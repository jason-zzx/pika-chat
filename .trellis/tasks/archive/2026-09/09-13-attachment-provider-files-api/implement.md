# 执行计划：Files API 引用传输 + 音视频原生直通

## 实施清单（有序）

**第 0 步（验证点，先行）**

1. [x] 实证 `convertToModelMessages` 透传 file part `providerReference`（google + claude 各一，最小脚本）；实证 SDK 错误对象形状（statusCode 字段位置）。结果写回 design.md §4。

**第一刀：schema 与基础设施**

2. [x] migration：files.provider_references jsonb、provider_configs.files_api_unsupported_at。
3. [x] provider-factory.ts：`createFilesApi(endpoint)`（google/claude 返回 provider 实例，其余 null）。
4. [x] provider.service.ts：config 更新时清除负缓存标记。
5. [x] chat-model.ts：`ChatModelHandle` 透出 apiFormat + providerConfigId。

**第二刀：Files API 引用路径**

6. [x] provider-files.ts：`ensureProviderReference` + 错误分类 + 过期续传。
7. [x] attachments.ts：capabilities 扩展 + native 分支三级路由；两个调用点（chat/regenerate）传新参数。
8. [x] 单测：provider-files + attachments 路由矩阵。

**第三刀：音视频直通**

9. [x] media-types.ts：audio/video 分类 + 白名单 + accept + 别名。
10. [x] file.service：音视频跳过抽取。
11. [x] attachments.ts：AV 双判定 + `file.mediaUnsupported` 硬错误；i18n key。
12. [x] 前端：chip 图标、消息卡片 `<audio>/<video>` 预览。

**收尾**

13. [ ] 手测矩阵（design §7）+ 一期回归；check 全绿。

## 验证命令

```bash
pnpm test -- src/server/ai src/server/files src/lib/files
pnpm lint && pnpm typecheck
pnpm db:generate && pnpm db:migrate   # 以仓库实际 drizzle script 为准
```

## 高风险点与回滚

- **providerReference 不透传**（第 0 步验证点）：若不成立，备选方案已写在 design §4，改动仍收敛在 attachments.ts。
- **Gemini PROCESSING 轮询时长**：SDK 内部轮询，大文件可能数秒；发送路径需容忍（上传在流式响应开始前完成即可，用户感知为发送延迟；若实测过久，评估异步化——本期不预埋）。
- **负缓存误伤**：分类表把真正的瞬时错误误判为永久会把 provider 永久踢出引用路径；错误分类单测必须覆盖 SDK 各错误形状。
- 回滚：revert 即回一期行为，两列新 schema 留存无害。

## 开工前检查

- [x] `task.py start` 前 prd/design/implement 已经用户审阅。
- [x] implement.jsonl 已配置（spec 清单）。
- [x] 第 0 步验证结论已回填 design.md。
