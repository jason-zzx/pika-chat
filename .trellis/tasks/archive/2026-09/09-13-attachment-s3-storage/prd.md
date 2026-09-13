# S3 兼容对象存储实现

## Goal

在既有 `FileStorage` 接口后实现 S3 兼容对象存储（S3 / MinIO / R2 等），通过环境变量切换后端，本地磁盘保持默认；文件服务与 API 层不感知后端差异，支撑多副本/容器化部署。

## Background / Confirmed Facts

- 一期接口已预留：`FileStorage { put(key, data: Buffer); get(key): Buffer; delete(key) }`，`LocalDiskFileStorage` 默认实现，进程级单例 `getFileStorage()`（src/server/files/storage.ts）。
- key 布局 `<userId>/<fileId>`，对调用方不透明；`LocalDiskFileStorage.resolveKey` 有路径穿越防护。
- 业务调用点：`file.service.ts`（上传/下载/删除）与 `attachments.ts`（原生传输读字节），全部经 `getFileStorage()`，无直连磁盘的旁路。
- env 管理：`src/server/env.ts` 用 zod 解析 + 缓存，新增 S3 配置项在此扩展。
- 20MB 上限下 Buffer 全量读写可接受（一期 design 已拍板），S3 实现同样用 Buffer，不做流式。

## Requirements

### R1 S3 实现

- 新增 `S3FileStorage implements FileStorage`：put/get/delete 语义与磁盘实现一致（delete 幂等，与磁盘 `force: true` 对齐）。
- 基于 `@aws-sdk/client-s3`（server-only，模块化 v3 客户端；不引入 minio 专用 SDK）。
- key 沿用 `<userId>/<fileId>` 布局，直接映射为 object key；保留 key 合法性校验（拒绝绝对路径/`..` 段），与磁盘实现同一防护契约。

### R2 配置与切换

- env 新增（全部可选）：`S3_BUCKET`、`S3_REGION`、`S3_ENDPOINT`（任意 S3 兼容端点，非厂商专属配置）、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`。
- 后端选择规则：`S3_BUCKET` 非空 → S3；否则本地磁盘（现状不变，零迁移成本）。`S3_BUCKET` 与 `FILE_STORAGE_DIR` 同时设置时前者生效。
- **开箱即用**：S3 后端首次使用时自动确保 bucket 存在（HeadBucket → 404 则 CreateBucket），用户填完配置启动即可用，无需先到控制台手动建桶；端点不可达/凭证错误 → 可读错误。
- `S3_BUCKET` 设置但缺凭证 → 启动即报清晰错误，不延迟到首个请求。
- 凭证不入库、不进日志。

### R3 部署形态

- 新增 `docker-compose.prod.rustfs.yml` 覆盖文件：追加 `rustfs` 服务（官方镜像，9000 API / 9001 控制台，命名卷持久化）并把 app 的 `S3_*` 环境指向容器内 rustfs。
- 用户两种部署选择：`docker compose -f docker-compose.prod.yml up`（chat+pg，现状）或叠加 rustfs 覆盖文件（chat+pg+rustfs）。基础 compose 文件不做任何修改。

### R4 验证

- 单测：mock S3Client 验证 put/get/delete 调用参数与幂等语义；key 校验拒绝非法 key；bucket 自举逻辑（存在则不建、404 则建、其他错误上抛）。
- 手测：`docker compose -f docker-compose.prod.yml -f docker-compose.prod.rustfs.yml up` 从零启动，上传→发送→下载全链路，不手动建桶。

## Acceptance Criteria

- [ ] 不配任何 S3 环境变量时行为与现状完全一致（磁盘默认）。
- [ ] 配置 MinIO 或 RustFS（或任一 S3 兼容端点）后，上传/抽取/发送（原生内联读字节）/下载/删除全链路正常。
- [ ] 从零启动 rustfs 覆盖 compose，不手动建桶即完成首个上传（bucket 自举生效）。
- [ ] 基础 prod compose（无覆盖文件）行为与现状完全一致。
- [ ] 删除不存在的 key 不报错（幂等）。
- [ ] 配置缺失（有 bucket 无凭证等）启动期给出可读错误。
- [ ] 非法 storage key（`..`、绝对路径）在 S3 实现同样被拒绝。
- [ ] file.service / attachments 调用点零改动（接口契约验证）。

## Out of Scope

- 磁盘 ↔ S3 之间的存量文件迁移工具（二期部署假设为新实例或接受手工迁移）。
- 分片上传/流式读写（20MB 上限下无必要）。
- 预签名 URL 直传（上传仍经 `POST /api/files` 服务端中转）。
