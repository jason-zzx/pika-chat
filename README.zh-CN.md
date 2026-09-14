<p align="center">
  <img src="src/app/icon.svg" width="96" height="96" alt="Pika Chat logo" />
</p>

<h1 align="center">Pika Chat</h1>

<p align="center">
  <strong>专为速度、隐私与完全自主掌控打造的现代化开源自托管多模态 AI 聊天工作台。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Drizzle_ORM-PostgreSQL-c5f74f?logo=drizzle" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker Ready" />
</p>

---

**Pika Chat** 是一套注重隐私的自托管多模态 AI 聊天系统，面向个人极客与团队协作设计。支持接入各类大模型服务商、联网搜索并提供精确引用来源、多格式文件解析与多模态交互、结构化助手与话题管理，拥有兼顾桌面多屏与触屏移动端的优雅交互界面。

---

## 核心特性

- **零维护开箱即用理念**：提供开箱即用的合理默认配置——本地磁盘存储、启动自动迁移数据库、S3 存储桶首次访问自动创建、孤儿文件自动回收清理。
- **隐私与安全至上**：服务商 API Key 落库采用 AES-256-GCM 认证加密；支持多角色权限控制（RBAC）、TOTP 两步验证（2FA）及用户存储配额隔离。
- **全能多模态文件支持**：支持拖拽上传图片、多格式文档（PDF、DOCX、XLSX、PPTX、EPUB、TXT、Markdown）、音频及视频；即时提取文本，并在跨模型切换时实现多模态与文本回退动态自适应。
- **现代高性能架构**：基于 Next.js 16 App Router、React 19、Tailwind CSS v4 构建；流式打字输出配合防抖动态滚屏与平滑贴底，可选 S3 客户端直传技术极大降低服务器负载。

---

## 功能亮点

### 🤖 多服务商与模型编排
- **广泛兼容的接口协议**：原生支持 OpenAI、Anthropic (Claude)、Google Gemini、Ollama、OpenRouter、DeepSeek、Groq、Mistral、Moonshot 及任意兼容 OpenAI 的第三方中转或本地网关。
- **接口模型自动发现**：一键从服务商端点（`/v1/models`）自动发现并同步可用模型列表。
- **精细化模型参数配置**：独立设置模型上下文窗口上限、思考推演力度（Reasoning Effort / Thinking）、支持的输入模态以及自定义厂商图标。
- **密钥安全加密**：所有 API Key 在数据库中均经过 AES-256-GCM 加密存储（依赖 `CREDENTIAL_ENCRYPTION_SECRET`），不向客户端泄露，不输出日志。
- **私有与全员共享**：支持将经过验证的服务商配置一键共享给全站成员，亦可保留个人私有密钥。

### 💬 卓越的对话交互体验
- **非末尾消息分支重新生成**：支持重新生成任意历史助手回复，不丢弃、不截断后续上下文。通过 `group_id` 与服务端持久化选择状态管理多版本分支。
- **富文本 Markdown 与代码高亮渲染**：基于 Streamdown 构建，支持实时 KaTeX 数学公式渲染、交互式 Mermaid 图表、语法高亮代码块（支持一键复制），以及针对中文标点排版优化的 CJK 文本渲染。
- **智能平滑滚动控制**：回复生成期间通过底部预留高度算法防止页面频繁跳动，同时监听用户滚轮与触摸手势，自然取消强行贴底吸附。
- **移动端深度适配**：自适应分栏布局、移动端轻触唤出操作菜单（彻底摆脱桌面悬停依赖）、无遮罩式原生级下拉选择组件。
- **助手与话题分类**：支持针对特定工作流创建专属 Prompt 与默认模型的助手，支持话题置顶、关键词搜索与对话记录导出。

### 📎 多模态附件与文档解析引擎
- **广泛的文件格式解析**：
  - **文档**：PDF、Word (`.docx`)、Excel (`.xlsx`)、PowerPoint (`.pptx`)、EPUB、纯文本及 Markdown。
  - **音视频与多媒体**：JPEG、PNG、GIF、WebP、WAV、MP3、MPEG、MP4、WebM。
- **上传即解析**：上传时即时完成文档内容提取，统计页数与字符，自动清除 C0 控制字符，在发送前以预览标签呈现解析状态与字数提示。
- **动态模型上下文回放**：向支持视觉/音频的先进模型发送原生多模态数据；在历史会话切换至仅支持文本的模型时，自动退回到已缓存的文档纯文本提取内容。
- **厂商 Files API 深度协同**：对接 Gemini 与 Anthropic 的官方文件 API，内置文件有效期追踪与过期懒重传策略。

### 🔍 实时联网搜索与引用来源
- **大模型 Function Calling 工具调用**：模型根据用户问题智能判断是否需要执行联网搜索。
- **多搜索源与故障回退**：支持接入 Brave Search、Tavily、Exa、Firecrawl，支持自定义回退链。
- **深层页面抓取**：内置 `fetchPage` 工具深度抓取落地页网页内容，辅助模型生成详尽回答。
- **规范化溯源引用**：全局统一分配单次对话唯一的引用序号（`[1]`, `[2]`），精准关联原文来源。

### 🗄️ 可插拔存储：本地磁盘与 S3 兼容对象存储
- **零配置本地磁盘存储**：无需额外准备对象存储，附件默认存放在本地磁盘（`.data/files`）。
- **标准 S3 兼容协议支持**：配置 `S3_BUCKET` 即可无缝切换至 AWS S3、MinIO、Cloudflare R2 或 RustFS；存储桶在初次使用时自动建立。
- **客户端直传直链模式 (`S3_DIRECT_ACCESS=1`)**：彻底释放应用服务器带宽——浏览器通过短期预签名 POST 策略直传 S3 存储桶，通过 302 重定向直连预签名 GET 链接下载与预览文件。
- **内置 RustFS 容器套件**：一行命令即可同时启动全套自托管应用与高性能轻量级 S3 兼容存储。

### 🛡️ 完善的用户权限体系与配额管理
- **Better Auth 驱动**：支持邮箱/密码认证与 TOTP 两步验证（2FA）。
- **开箱初始化向导**：首次部署自动引导访问 `/setup` 初始化超级管理员，无需手动修改数据库。
- **多级权限分权**：超级管理员（Super Admin）、管理员（Admin）与普通用户（Member）分级授权机制。
- **文件存储配额控制**：支持设置全站默认配额（默认 5 GiB）及按用户定制配额，内置后台孤儿文件扫描与清理。
- **全站运营配置**：在管理员控制台轻松切换开放注册/关闭注册，一键封禁恶意用户或重置密码。

### 🌐 国际化双语支持 (i18n)
- 完整内置**英文**与**简体中文**界面语言包，可在**设置 → 通用**中随时切换。

---

## 快速开始

### 方案 1：生产环境全能一体化部署（`docker-compose.full.yml`，推荐）

通过 Docker 一键拉起应用服务、PostgreSQL 数据库及 RustFS（S3 兼容附件存储），内置数据卷持久化并自动执行数据库版本迁移。默认直接拉取官方预构建镜像（`ghcr.io/jason-zzx/pika-chat:latest`），无需本地编译。

1. **克隆项目代码**：
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   ```
   生成并填入安全密钥（需至少 32 字符）：
   ```bash
   openssl rand -base64 48
   ```
   编辑 `.env` 文件，填入生成的随机密钥及数据库密码：
   ```env
   CREDENTIAL_ENCRYPTION_SECRET=你生成的加密密钥
   BETTER_AUTH_SECRET=你生成的会话签名密钥
   POSTGRES_PASSWORD=自定义数据库密码
   ```

3. **启动全套生产服务**：
   ```bash
   docker compose -f docker-compose.full.yml up -d
   ```

4. **初始化管理员**：
   在浏览器中访问 **`http://localhost:3000/setup`**，按照向导创建首位超级管理员账户。

---

### 方案 2：生产环境独立应用部署（`docker-compose.standalone.yml`，自带数据库）

若您已有外部 PostgreSQL 实例（如云数据库 RDS、Supabase、Neon 或自建数据库集群），以及可选的外部 S3 对象存储，可通过 `docker-compose.standalone.yml` 单独启动应用服务，不创建任何多余的本地容器：

1. **克隆项目代码**：
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   ```
   编辑 `.env` 文件配置外部数据库连接信息与密钥：
   ```env
   # 方式一：直接提供完整的数据库连接串
   DATABASE_URL=postgres://user:password@your-pg-host:5432/pika_chat

   # 方式二：或者提供分立的连接变量（系统会自动对特殊字符密码进行 URL 编码）
   # POSTGRES_HOST=your-pg-host
   # POSTGRES_PORT=5432
   # POSTGRES_USER=user
   # POSTGRES_PASSWORD=password
   # POSTGRES_DB=pika_chat

   CREDENTIAL_ENCRYPTION_SECRET=你生成的加密密钥
   BETTER_AUTH_SECRET=你生成的会话签名密钥

   # 可选：配置外部 S3 对象存储
   # S3_BUCKET=my-bucket
   # S3_ACCESS_KEY_ID=...
   # S3_SECRET_ACCESS_KEY=...
   ```

3. **启动独立应用服务**：
   ```bash
   docker compose -f docker-compose.standalone.yml up -d
   ```

---

### 方案 3：本地开发环境搭建（`docker-compose.dev.yml`）

#### 环境要求
- **Node.js**: >= 22
- **pnpm**: 11.9+
- **Docker** 或 **Podman**（用于拉起本地 PostgreSQL 开发数据库）

#### 操作步骤

1. **克隆并安装依赖**：
   ```bash
   git clone https://github.com/jason-zzx/pika-chat.git
   cd pika-chat
   pnpm install
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   ```
   编辑 `.env` 文件，填入通过 `openssl rand -base64 48` 生成的随机安全密钥。

3. **启动本地 PostgreSQL 开发数据库**：
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

4. **执行数据库结构迁移**：
   ```bash
   pnpm db:migrate
   ```

5. **启动前端开发服务**：
   ```bash
   pnpm dev
   ```

6. 浏览器打开 **`http://localhost:3000/setup`** 完成初始管理员创建。

---

## 环境变量配置说明

Pika Chat 通过根目录 `.env` 文件或容器环境进行配置：

| 变量名称 | 是否必填 | 默认值 | 说明 |
|---|:---:|:---:|---|
| `DATABASE_URL` | **是\*** | — | PostgreSQL 连接字符串（例如：`postgres://pika:pika@localhost:5432/pika_chat`）。\*亦可改用分立的 `POSTGRES_*` 变量。 |
| `POSTGRES_HOST` | 否 | `localhost` / `postgres` | 外部 PostgreSQL 服务器主机名（未提供 `DATABASE_URL` 时生效）。 |
| `POSTGRES_PORT` | 否 | `5432` | 外部 PostgreSQL 端口号。 |
| `POSTGRES_USER` | 否 | `postgres` / `pika` | 数据库用户名（自动 URL 编码）。 |
| `POSTGRES_PASSWORD` | 否 | — | 数据库连接密码（自动 URL 编码）。 |
| `POSTGRES_DB` | 否 | `pika_chat` | 数据库名称。 |
| `CREDENTIAL_ENCRYPTION_SECRET` | **是** | — | 用于对模型 API Key 执行 AES-256-GCM 落库加密的密钥（至少 32 字符）。**请务必妥善备份**，一旦丢失将永久无法解密已存凭据。 |
| `BETTER_AUTH_SECRET` | **是** | — | 用于签名 Better Auth 会话令牌的加密密钥（至少 32 字符）。 |
| `BETTER_AUTH_URL` | 否 | `http://localhost:3000` | 部署站点的公网访问 URL。在反向代理或自定义域名环境下建议显式配置。 |
| `FILE_STORAGE_DIR` | 否 | `.data/files` | 本地存储模式下存放附件文件的磁盘物理路径。 |
| `FILE_UPLOAD_MAX_MB` | 否 | `20` | 单个附件允许的最大体积（单位：MiB，有效整数范围：`1`–`100`）。设置超出范围将在启动时报错退出。 |
| `S3_BUCKET` | 否 | — | 设置该项后，附件存储将自动切换为 S3 兼容对象存储。若指定的桶不存在，将在首次写入时自动创建。 |
| `S3_ENDPOINT` | 否 | 官方 AWS 端点 | 自定义 S3 端点（如 `http://minio:9000` 或 `https://<account>.r2.cloudflarestorage.com`）。检测到非 AWS 端点时会自动开启 Path-Style 寻址。 |
| `S3_REGION` | 否 | `us-east-1` | S3 所在地区。 |
| `S3_ACCESS_KEY_ID` | 使用 S3 时必填 | — | S3 访问凭据 Access Key ID。 |
| `S3_SECRET_ACCESS_KEY` | 使用 S3 时必填 | — | S3 访问凭据 Secret Access Key。 |
| `S3_DIRECT_ACCESS` | 否 | `false` | 设置为 `1` 或 `true` 开启客户端直传直链模式（前端通过预签名 POST 直传、预签名 302 GET 直接访问）。需配合 `S3_BUCKET` 使用。 |
| `PIKA_IMAGE` | 否 | `ghcr.io/jason-zzx/pika-chat:latest` | Compose 编排中拉取的应用容器镜像地址与标签。 |
| `TEST_DATABASE_URL` | 仅测试环境 | — | 运行 Vitest 集成测试专用的测试数据库连接字符串（如 `postgres://pika:pika@localhost:5432/pika_chat_test`）。 |

---

## 存储架构拓扑

```
                                  +-----------------------+
                                  |    本地磁盘物理存储   |
                                  |  (FILE_STORAGE_DIR)   |
                                  +-----------^-----------+
                                              |
+----------+          文件上传 / 下载         | (默认模式)
|  客户端  | <=========================> [ 应用服务器 ]
+----+-----+                                  |
     |                                        | (当配置 S3_BUCKET 时)
     | (当启用 S3_DIRECT_ACCESS=1 时)          v
     |                             +----------------------+
     +---------------------------> | S3 兼容对象存储服务  |
         短期预签名 POST / GET 直传 | AWS S3 / MinIO /     |
                                   | RustFS / Cloudflare  |
                                   +----------------------+
```

- **本地存储**：文件按哈希命名存放在 `FILE_STORAGE_DIR` 目录中。Docker 部署时请通过数据卷（Volume）持久化该目录。
- **S3 存储**：配置 `S3_BUCKET` 后，系统底层透明切换至对象存储驱动，支持冷启动自动建桶。
- **S3 直传直链模式**：开启 `S3_DIRECT_ACCESS=1` 后，上传操作由客户端直接通过预签名 POST 请求送达存储桶，预览与下载则通过 302 重定向到预签名 GET 链接，完全旁路应用服务器流量。请确保存储桶正确配置 CORS 跨域规则：
  ```json
  [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["POST", "GET", "HEAD"],
      "AllowedOrigins": ["https://your-chat-domain.com"],
      "ExposeHeaders": ["ETag"]
    }
  ]
  ```

---

## 技术选型

- **全栈框架**：[Next.js 16](https://nextjs.org/)（App Router 架构，支持 Standalone 独立输出）
- **前端交互与 UI**：[React 19](https://react.dev/)、[Base UI](https://base-ui.com/)、[Tailwind CSS v4](https://tailwindcss.com/)、[Lucide React](https://lucide.dev/)
- **模型与推理集成**：[Vercel AI SDK](https://sdk.vercel.ai/)（`ai`、`@ai-sdk/openai-compatible`、`@ai-sdk/anthropic`、`@ai-sdk/google`）
- **数据库与持久化**：[PostgreSQL 17](https://www.postgresql.org/)、[Drizzle ORM](https://orm.drizzle.team/)、[postgres.js](https://github.com/porsager/postgres)
- **身份认证体系**：[Better Auth](https://better-auth.com/)（内置 TOTP 两步验证）
- **富文本与公式解析**：[Streamdown](https://github.com/streamdown/streamdown)、KaTeX 数学公式、Mermaid 图表、`@streamdown/cjk` 文本优化
- **文档提取工具集**：`unpdf` (PDF)、`mammoth` (DOCX)、`xlsx` (Excel)、`jszip` (EPUB/PPTX)
- **对象存储适配**：`@aws-sdk/client-s3`、`@aws-sdk/s3-presigned-post`、`@aws-sdk/s3-request-presigner`
- **国际化引擎**：[next-intl](https://next-intl.dev/)
- **测试框架**：[Vitest](https://vitest.dev/)、React Testing Library、PostgreSQL 真实集成测试套件

---

## 开发与验证规范

每次代码提交前，需通过以下质量门禁：

```bash
# 代码风格校验与静态扫描
pnpm lint

# TypeScript 严格类型检查
pnpm typecheck

# 单元测试与集成测试全量验证（需确保本地 Postgres 已启动）
pnpm test
```

数据库结构演进管理：
```bash
# 根据 Drizzle Schema 变动自动生成 SQL 迁移脚本
pnpm db:generate

# 执行数据库结构迁移应用
pnpm db:migrate
```

---

## 开源协议

本项目采用 MIT 许可证开源。
