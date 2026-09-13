# 执行计划：S3 兼容对象存储

## 实施清单（有序）

1. [x] 安装 `@aws-sdk/client-s3`。
2. [x] `src/server/env.ts`：新增 6 个 S3 配置项（全部可选）。
3. [x] storage.ts：提取共用 `assertValidStorageKey`；实现 `S3FileStorage`（含 promise 缓存的 `ensureBucket()` 自举）；`getFileStorage()` 按 env 选择 + 构造期校验。
4. [x] 单测：storage.test.ts 追加 S3 用例（mock client：put/get/delete、幂等 delete、key 校验、bucket 自举三分支）+ env 选择逻辑用例；磁盘既有用例保持绿。
5. [x] 新增 `docker-compose.prod.rustfs.yml` 覆盖文件（design §3.1）；基础 compose 不动。
6. [x] 手测：覆盖文件从零启动（不手动建桶）→ 上传→发送含原生内联→下载→删除全链路；再验证无覆盖文件时磁盘路径无回归。
7. [x] README/部署文档补 S3 env 与两种部署形态说明（若仓库有部署文档；否则记入 journal）。

## 验证命令

```bash
pnpm test -- src/server/files
pnpm lint && pnpm typecheck
docker compose -f docker-compose.prod.yml -f docker-compose.prod.rustfs.yml up --build
# 从零启动，不手动建桶，直接走上传→发送→下载全链路
```

## 高风险点与回滚

- **env 组合校验遗漏**：有 bucket 无凭证必须启动期炸出可读错误，不能延迟到首个上传请求。
- **path-style vs virtual-hosted**：MinIO/RustFS 在容器网络内只认 path-style；`S3_ENDPOINT` 存在时默认开，显式 `S3_FORCE_PATH_STYLE` 可覆盖。
- **compose 覆盖的 environment 合并语义**：app 原有的 `FILE_STORAGE_DIR` 保留但被 `S3_BUCKET` 优先规则旁路，手测必须验证不是两个后端同时写。
- 回滚：摘 env 重启即回磁盘，代码纯增量。

## 开工前检查

- [x] `task.py start` 前 prd/design/implement 已经用户审阅。
- [x] implement.jsonl 已配置（spec 清单）。
