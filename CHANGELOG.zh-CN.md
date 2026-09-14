# 更新日志

本项目的所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
且本项目严格遵循 [语义化版本 (Semantic Versioning)](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-09-14

### Highlights

- **Pika Chat 首发版本发布**：专为速度、隐私与完全自主掌控打造的现代化开源自托管多模态 AI 聊天工作台。
- **多模型服务商与统一编排**：原生支持接入 OpenAI、Anthropic (Claude)、Google Gemini、Ollama、OpenRouter、DeepSeek 以及任意兼容 OpenAI 协议的模型接口；服务商凭据在数据库中采用 AES-256-GCM 认证加密。
- **全格式多模态附件流水线**：支持拖拽上传图片、多格式文档（PDF、Word、Excel、PowerPoint、EPUB、纯文本、Markdown）、音频与视频，具备即时文本解析与跨模型动态回退能力。
- **实时联网搜索与精准溯源**：基于大模型 Function Calling 的智能搜索，支持多源回退（Brave、Tavily、Exa、Firecrawl）、深度网页抓取与单轮唯一连续引用角标。
- **开箱即用的可插拔存储体系**：默认使用本地磁盘物理存储，配置 `S3_BUCKET` 自动无缝切换至 S3 兼容对象存储并自动建桶，支持客户端直传直链模式（`S3_DIRECT_ACCESS`），提供开箱即用的 RustFS 一体化 Compose 编排。
- **企业级权限治理与配额体系**：集成 Better Auth 身份认证、TOTP 两步验证（2FA）、RBAC 多级权限（超级管理员、管理员、普通用户）、细粒度用户存储配额控制与开箱初始化向导（`/setup`）。
- **完善的国际化双语支持**：完整内置英文与简体中文界面与错误提示，支持在设置中随心切换。

### Feats

- **现代对话交互**：
  - 非末尾助手消息分支重新生成：支持重新生成任意历史回答，不丢失、不截断后续对话分支，通过 `group_id` 与服务端持久化选择状态管理多版本。
  - 防抖平滑流式滚动：消息生成期间底部预留高度，防止页面频繁跳动；智能识别滚轮与触摸手势，自然取消贴底吸附。
  - Streamdown 富文本渲染：支持实时 KaTeX 数学公式、交互式 Mermaid 图表、代码语法高亮与一键复制，以及针对中文标点优化的 CJK 文本排版。
  - 移动端触控深度适配：轻触唤出消息操作菜单（完全解绑桌面悬停）、无遮罩式原生级下拉选择组件。
  - 助手与话题管理：自定义系统指令与默认模型的专属助手，支持话题置顶、关键词检索与对话历史导出。
- **AI 模型编排管理**：
  - 支持从服务商端点（`/v1/models`）一键自动发现可用模型。
  - 每个模型均可独立设置上下文 Token 上限、思考推演力度（Reasoning Effort / Thinking）、支持模态与厂商图标。
  - 区分个人私有配置与全员共享配置。
- **多模态附件引擎**：
  - 上传即解析：支持 PDF、DOCX、XLSX、PPTX、EPUB、TXT 和 Markdown 文档，自动清理 C0 控制字符并在发送区以标签卡片显示字数与页数统计。
  - 动态上下文回放：向支持视觉/音频的模型提供原生多模态数据，向仅支持文本的模型自动回退为已缓存的文档纯文本内容。
  - 厂商 Files API 深度协同：对接 Gemini 与 Anthropic 官方文件 API，内置文件有效期追踪与过期懒重传机制。
- **存储与配额管控**：
  - S3 兼容对象存储支持冷启动自动建桶（支持 AWS S3、MinIO、Cloudflare R2、RustFS）。
  - 客户端直传直链模式（预签名 POST 上传与预签名 302 GET 下载），旁路应用服务器流量。
  - 全站默认存储配额（5 GiB）与按用户定制配额，内置后台孤儿文件扫描与自动清理回收。
- **安全与系统治理**：
  - 模型 API Key 采用 AES-256-GCM 落库认证加密。
  - 开箱即用的 `/setup` 初始化向导，无需手动操作数据库即可安全建立首位超级管理员。
  - 全局运营控制：自由切换开放/关闭全站注册，一键封禁恶意用户或重置密码。

### Fixes

- 修复流式输出中偶发泄露的 `<tool_call>` 标签，通过持留变换管道与落库过滤进行清洗。
- 引入 `remark-cjk-friendly` 修复 CJK 标点相邻时 Markdown 加粗强调解析失效的问题。
- 优化消息附件创建时序：在前置校验完全通过后再写入用户消息，避免附件异常时残留导致话题卡死的无效消息。
- 清理 PDF 提取文本中的 NUL 字节（`0x00`），避免 PostgreSQL UTF-8 文本列报错。

### Dev

- 完善的自动化测试体系：包含 130 个测试套件、1000+ 测试用例的 Vitest 单元与 PostgreSQL 集成测试。
- 生产级 Dockerfile：Next.js Standalone 独立构建输出，容器启动时自动执行增量数据库迁移。
- 生产级 Docker Compose 编排：全功能一体化（`docker-compose.full.yml`）、独立应用接入外部数据库（`docker-compose.standalone.yml`）与本地开发数据库（`docker-compose.dev.yml`）。
- 配置 GitHub Actions CI：涵盖 Lint 代码检查、Typecheck 类型校验、全量集成测试与 Docker 构建冒烟测试。
- 多架构容器镜像自动化发布流水线：支持 `linux/amd64` 与 `linux/arm64` 跨架构构建并自动推送到 GHCR，自动根据 CHANGELOG 生成 GitHub Release。
