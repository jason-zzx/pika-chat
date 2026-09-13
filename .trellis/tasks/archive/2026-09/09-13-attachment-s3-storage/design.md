# 技术设计：S3 兼容对象存储

## 1. 边界

只动两个文件 + 一个新模块：

- `src/server/files/storage.ts`：新增 `S3FileStorage`，`getFileStorage()` 按 env 选择后端。
- `src/server/env.ts`：新增 S3 配置项。
- 新依赖 `@aws-sdk/client-s3`（server-only；v3 模块化只打包 s3 client）。

业务调用点（file.service、attachments）零改动——这正是接口预留的意义，验收标准里作为回归检查。

## 2. S3FileStorage

```ts
class S3FileStorage implements FileStorage {
  constructor(client: S3Client, bucket: string)
  put(key, data)  → PutObjectCommand({ Bucket, Key: key, Body: data })
  get(key)        → GetObjectCommand → Body.transformToByteArray() → Buffer
  delete(key)     → DeleteObjectCommand（S3 删除天然幂等，对齐磁盘 force:true）
}
```

- key 校验：提取 `LocalDiskFileStorage.resolveKey` 里的防护语义为共用函数 `assertValidStorageKey(key)`（拒绝空、绝对路径、`..` 段），两个实现共用——key 今天由服务端生成，但防护契约不随后端改变。
- get 的 NoSuchKey → 让原始错误上抛，调用方（file.service）既有 404 语义不变；不包一层自定义错误。

**Bucket 自举**：构造保持同步；首次 put/get/delete 前经一个 promise 缓存的 `ensureBucket()`——HeadBucket 成功即缓存；404 → CreateBucket 后缓存；其他错误（不可达/凭证拒绝）原样上抛为可读错误。用户填完配置启动即用，无需控制台手动建桶。

## 3. 配置

env.ts 新增：

```ts
S3_BUCKET: z.string().min(1).optional(),
S3_REGION: z.string().min(1).optional(),
S3_ENDPOINT: z.url().optional(),           // 兼容端点；空 = AWS 官方
S3_ACCESS_KEY_ID: z.string().min(1).optional(),
S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
S3_FORCE_PATH_STYLE: z.enum(["true","false"]).optional(), // MinIO 需要 true
```

构造规则（getFileStorage）：

- 无 `S3_BUCKET` → LocalDiskFileStorage（现状）。
- 有 bucket：region 缺省回落 `us-east-1`（兼容端点惯例）；`S3_ENDPOINT` 存在时默认 forcePathStyle=true（MinIO/RustFS 在无通配 DNS 的容器网络内需要 path-style），可被显式覆盖；凭证缺失 → 抛可读错误。
- 单例缓存沿用现状（`let storage`），测试通过重置模块状态隔离。

## 3.1 Docker Compose 覆盖文件（rustfs）

新增 `docker-compose.prod.rustfs.yml`，基础 `docker-compose.prod.yml` **不改动**：

```yaml
services:
  rustfs:
    image: docker.io/rustfs/rustfs:latest
    environment:
      # 镜像只认自己的 env 名，值映射自用户唯一的 S3_* 配置来源，
      # 保证 rustfs 凭据与 app 的 S3 凭据永远一致，且不引入 RUSTFS_* 用户变量
      RUSTFS_ACCESS_KEY: ${S3_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID}
      RUSTFS_SECRET_KEY: ${S3_SECRET_ACCESS_KEY:?set S3_SECRET_ACCESS_KEY}
      RUSTFS_ADDRESS: ":9000"
      RUSTFS_CONSOLE_ADDRESS: ":9001"
      RUSTFS_CONSOLE_ENABLE: "true"
    volumes:
      - rustfs_data:/data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9000/health || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 12
    # 控制台端口默认不暴露到宿主机；需要时用户自行加 ports: 9001:9001

  app:
    environment:
      S3_BUCKET: ${S3_BUCKET:-pika-attachments}
      S3_ENDPOINT: http://rustfs:9000
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?set S3_SECRET_ACCESS_KEY}
      # S3_ENDPOINT 存在时服务端默认 path-style，无需显式设置
    depends_on:
      rustfs:
        condition: service_healthy

volumes:
  rustfs_data:
```

要点：

- **用户只需一套 S3_* 变量**（`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` 必填，`S3_BUCKET` 可选有默认值）；`RUSTFS_*` 仅是 compose 内部的镜像适配映射，不出现在用户配置面。
- `environment:` 在 compose 覆盖里是**按 key 合并**，所以 app 原有的 `FILE_STORAGE_DIR` / 卷挂载保留但不再被使用（`S3_BUCKET` 优先）；文档里明示这一优先级，避免读者困惑。
- 不发布 9000/9001 到宿主机：app 走容器网络访问；控制台默认不外露。
- secret 用 `:?` 强制显式提供，复用现有 `CREDENTIAL_ENCRYPTION_SECRET` 的惯例。
- 健康检查端点以实现时 rustfs 镜像实际提供的为准（`/health` 或 minio 兼容路径）。
- dev compose（`docker-compose.yml`）不动——开发态默认磁盘即可。

## 4. 测试策略

- 单测：mock `@aws-sdk/client-s3`（vi.mock 客户端 send），断言命令类型/参数、Buffer 转换、幂等 delete、key 校验。
- env 选择逻辑单测：各 env 组合 → 后端类型 / 构造错误。
- 集成手测：MinIO docker 起服务走全链路（不做进 CI 的强制要求，文档记录命令）。

## 5. 关键取舍记录

1. **`@aws-sdk/client-s3` 而非 minio SDK 或裸 fetch SigV4**：标准、维护好；server-only 所以包体积代价可接受；minio SDK 绑死单一厂商 API 风格。
2. **Buffer 全量读写**：沿用一期拍板（20MB 上限），不引入流式复杂度。
3. **env 切换而非配置页**：部署期关注点，一期二期均无管理 UI 计划（三期附件管理页候选）。
4. **不做迁移工具**：二期部署前提为新实例/手工迁移，写进 PRD Out of Scope 明示。

## 6. 运维与回滚

- 回滚 = 摘除 S3 env 变量重启，即回磁盘后端；S3 上的文件不回流（部署决策，已在 PRD 明示）。
- 新增 env 全部可选，对现有部署零影响。
