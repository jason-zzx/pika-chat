# 更新日志

本项目的所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
且本项目严格遵循 [语义化版本 (Semantic Versioning)](https://semver.org/lang/zh-CN/)。

## [1.0.0-rc.2] - 2026-11-21

### Highlights

- **统一嵌入式 SQLite 数据库（`better-sqlite3`）与 PostgreSQL 自动升级导入**：将容器部署中的 PostgreSQL 与桌面端本地模式及 CI 中的 PGlite 统一替换为单一嵌入式 `better-sqlite3` 数据库，通过 `DATABASE_PATH` 配置（Docker 默认为现有 `/data/files` 数据卷上的 `/data/files/pika-chat.db`，桌面本地模式为 `<userData>/local/pika-chat.db`），无需单独运行数据库容器。`v0.4.0`–`v1.0.0-rc.1` 的 PostgreSQL 实例在首次启动时保持原有 compose 文件与 `DATABASE_URL` / `POSTGRES_*` 配置即可自动将数据导入 SQLite。
- **消息文本引用与定位跳转**：在任意用户或助手消息正文中选中文本即可显示浮动**引用**按钮，将摘录作为独立卡片附着到输入框（作为 `<quote>` 上下文传给模型，同时保持用户输入文本原样不变），点击引用卡片即可居中定位并高亮闪烁原始文本段落。
- **侧边栏话题分页加载与更清爽的话题行交互**：助手侧边栏现全量加载收藏话题，并以每页 20 条滚动分页加载普通话题，同时提供紧凑的相对最后活跃时间、指针设备悬停浮层操作按钮与触屏长按菜单。

### Feats

- **嵌入式 SQLite 引擎与升级导入器**：
  - **SQLite 运行时与索引优化**：为 `better-sqlite3` 启用 WAL 模式、`foreign_keys = ON`、`busy_timeout = 5000`、同步 `immediate` 写事务与启动自动迁移；注册确定性 `file_category` UDF 支持附件分类筛选，保留 `(updated_at, id)` 游标分页与 `json_set` 增量合并，并为 `chat_messages` 添加 `AFTER INSERT` 与 `AFTER UPDATE OF parts` 触发器维护 `WITHOUT ROWID` 索引表 `message_file_refs`，使附件引用检查与话题/助手删除直接查询索引表而非扫描消息正文。
  - **PostgreSQL 一次性启动导入**：当配置了 `DATABASE_URL` 或旧版 `POSTGRES_*` 变量且 SQLite 中尚无 `postgres_import` 标记时，启动阶段会在单个只读 `repeatable read` 快照中读取 PostgreSQL，校验列结构是否匹配 `v0.4.0`–`v1.0.0-rc.1`（更早版本会提示先升级至 `v0.4.2`），在单事务内复制全部数据表，校验每张表的行数与 `PRAGMA foreign_key_check` 并写入导入标记；全程不写入 PostgreSQL，目标 SQLite 非空或表结构不匹配时直接拒绝启动，导入完成后后续启动将忽略 PostgreSQL 配置。
  - **精简 Docker 与 Compose 编排**：移除 `docker-compose.full.yml` 中的 `postgres` 服务与 `postgres_prod_data` 数据卷，删除 `docker-compose.dev.yml`、`docker/postgres/` 与 `scripts/migrate.ts`，容器直接通过 `node server.js` 启动并在 instrumentation 阶段完成自动迁移。
  - **桌面端本地模式（`native/desktop`）**：将本地模式从 PGlite 切换至 SQLite（`<userData>/local/pika-chat.db`），通过 `utilityProcess.parentPort` 优雅关闭并完成 WAL checkpoint，并在 `build-server.mjs` 中内置 Electron 环境下 `better-sqlite3` N-API 预编译产物的加载冒烟校验。
- **消息文本引用**：
  - 在单条消息正文中选区时，在选区上方（靠近视口顶部或触屏设备上则在下方）显示浮动**引用**按钮（`QuoteSelectionButton`），每份草稿最多附带一张可移除的两行预览 `QuoteCard`，且仅含引用时不允许发送。
  - 引用以 `data-quote` part 持久化并作为 `<quote>` 上下文回放给模型，在已发送用户气泡上方展示，且在就地编辑用户消息时支持移除；点击卡片可按记录偏移量定位回源文本并用逐行高亮闪烁（若源消息已编辑或无法匹配，则回退为整条消息闪烁）。
- **侧边栏话题分页与行设计重构**：
  - 将 `GET /api/assistants` 改为返回包含 `topicCount` 的助手列表，拆出 `GET /api/assistants/[id]/topics/favorites` 与游标分页的 `GET /api/assistants/[id]/topics`（每页 20 条，滚到底部自动加载，失败时展示重试按钮），并确保未在侧边栏加载的话题仍能正确显示聊天页标题、桌面完成通知及删除助手时的话题数统计。
  - 话题行右侧展示每分钟自动刷新的紧凑相对活跃时间（`formatTopicAge`，流式生成中切换为加载动画），指针设备悬停或聚焦时以右对齐浮层展示收藏与 `...` 按钮而不挤动标题截断，截断标题悬停展示完整标题 Tooltip；触屏设备隐藏行内按钮，长按约 500 ms 弹出带完整标题头部的操作菜单并屏蔽系统选区与默认菜单。
- **批量同步上游模型列表**：
  - 将服务商「从上游获取」升级为双页签对比弹窗（**现有模型**与**未返回模型**），支持**全部保留** / **全部取消勾选**快捷操作、上游返回 0 个模型时的风险提示，以及通过 `POST /api/providers/[id]/models/sync` 在单事务内原子完成批量新增与移除（整批仅加载一次目录元数据）。
- **「关于」设置页与原生客户端版本展示**：
  - 新增**设置 → 关于**（`/settings/about`）页面，展示当前版本、本地/演示模式徽章、一键**复制版本信息**按钮、GitHub 仓库/发布日志/问题反馈入口与 MIT 开源协议信息；同时在桌面端（`preload-remote.ts`）与 Android 端（`RemoteBridge.kt`）注入 `window.pikaNative.appVersion`，远程连接时可同时查看并复制服务端与客户端版本号。

### Fixes

- **下拉菜单遮罩层级**：为 `DropdownMenuContent` 的 `MenuPrimitive.Portal` 补充 `relative z-50`，避免模态下拉菜单遮罩被侧边栏或移动端抽屉等带 `z-index` 的容器遮挡或错层。
- **统一悬停高亮与搜索面板交互**：统一侧边栏用户/设置行、助手资料/删除行、`ToolCallShell` 浮层头部、`QuoteCard` 跳转按钮与 `ProviderConfigsScreen` 模型删除按钮（改用 `XIcon` 并修复暗色对比度）的行级与按钮悬停状态；让 `SearchDialog` 的键盘高亮与鼠标悬停保持同步，并在搜索框内增加一键清空按钮。
- **弹窗规范与确认流程统一**：将 `ExternalLinkDialog` 重构为标准 `AlertDialog` 组件并扩展至 `SearchToolCall` 搜索结果链接；将 `AdminUsersScreen` 的密码重置从 `window.prompt()` 改为带校验的 `Dialog` 表单（并为「封禁」操作补充危险样式与表格行悬停），为 `SearchProvidersScreen` 删除操作与 `ChatView` 手动压缩历史新增 `AlertDialog` 二次确认，并将 `TwoFactorCard` 对齐至 `SettingsSection` / `SettingsCard` 结构。
- **设置页布局、侧边栏与编辑器细节**：在桌面端设置页隐藏冗余的 `<InsetHeader />`（保留移动端抽屉入口），进入 `/settings/*` 时保持桌面端侧边栏展开且不覆盖聊天页原有的折叠状态；微调 `SidebarMenu` 间距（`md:gap-0.5`），修复 `PaneHeader` 长标题换行及图标折叠状态（`ThemeControl`、`LoadingRows` 与话题分组），优化 `Composer` / `UserMessageEditor` 聚焦环与移动端触控热区，修复 `FilesList` 勾选文件时的纵向跳动，并在未配置任何默认模型时禁用 `ModelPreferencesScreen` 的**全部重置**按钮。
- **原生壳界面（`native/shell-ui`）**：统一服务器列表整行悬停与右侧操作按钮的叠层悬停效果，将移除服务器的 `window.confirm()` 替换为自定义样式的 `<dialog>` 确认弹窗，去除进入列表时的默认首行焦点框并收敛到 `:focus-visible`，恢复 `cursor: pointer`，折叠空状态提示占位，并在检查更新时显示进行中状态。

### Dev

- 将 Vitest 集成测试（每 Worker 独立 `:memory:` SQLite）与 GitHub Actions（`ci.yml`、`release.yml`）全面切换为 SQLite，移除 PostgreSQL 服务容器与单独的 PGlite 任务，精简 `Dockerfile` 中不再需要的 C++ 编译工具链，并在 `ci.yml` 新增仅限手动触发（`workflow_dispatch`）的四平台 `desktop-smoke` 打包验证矩阵。

## [1.0.0-rc.1] - 2026-11-19

### Highlights

- **跨平台桌面客户端（Windows、macOS、Linux）**：全新 Electron 原生桌面应用，支持免配置的本地独立运行模式（「此电脑」，内置 PGlite 数据库）与多远程服务器连接，提供独立会话隔离、系统托盘、全局快捷键、回复完成通知及应用更新能力。
- **Android 客户端（APK）**：基于 Capacitor 8 构建的 Android 原生壳，连接已部署的 Pika Chat 服务端，支持仅限当前连接源的原生桥接注入、跟随主题色的系统栏、键盘避让布局、系统返回手势/按键导航、原生服务器切换弹窗与回复完成通知。
- **可安装 PWA 与移动端体验升级**：新增 Web App Manifest、安全区适配、跟随应用内主题变化的动态 `theme-color`，并全面优化移动端正文字号、行距与列表触控间距。

### Feats

- **桌面端应用（`native/desktop`）**：
  - **本地模式（「此电脑」）**：通过内置 PGlite 数据库与 `<userData>/local/` 本地磁盘存储启动打包的 Next.js 独立服务端，仅监听 `127.0.0.1` 并复用持久化端口。使用 Electron `safeStorage` 加密保存自动生成的实例密钥，静默登录本地超级管理员（自动隐藏 `/setup`、登录、退出、2FA 与用户管理页面），并在退出应用及安装更新前优雅关闭本地服务。
  - **多服务器远程模式**：支持添加并连接多个 Pika Chat 服务端，按服务器隔离会话与 Cookie（`persist:server-<id>`），连接前通过 `/api/health` 校验服务端主次版本兼容性并给出非阻塞提示；本地模式与远程模式数据互不干扰，切换时后台生成仍持续运行。
  - **原生桌面能力**：支持系统托盘与关闭最小化到托盘、可自定义的全局显示/隐藏快捷键（默认 `Ctrl+Shift+Space`）、窗口位置尺寸记忆、回复完成系统通知（点击唤起窗口并直达对应话题）、安全的附件打开策略（文档与媒体文件交由系统默认应用打开，脚本与可执行文件仅在文件管理器中定位），以及 Windows/Linux 应用内自动更新与 macOS 新版本跳转提示。
- **Android 应用（`native/mobile`）**：
  - **远程服务器壳**：支持原生持久化保存多个服务端、无跨域限制的健康检查、按源隔离的 Cookie 会话（移除服务器时自动清理对应源 Cookie），以及从侧边栏品牌行、账户菜单和登录页芯片唤起的原生单选服务器切换弹窗。
  - **源隔离的原生桥接**：仅向已连接服务器的主框架通过 `androidx.webkit` `WebMessageListener` 与 document-start 脚本注入 `window.pikaNative`，在原生层严格校验来源与参数边界（若 Android System WebView 缺少所需特性则直接报错提示更新，不回退到全源开放桥接）。
  - **系统栏、键盘与导航适配**：实现全屏 Edge-to-Edge 沉浸式布局，状态栏与导航栏背景及深浅图标对比度实时跟随页面 `theme-color`（兼容 `oklch`/`lab` 色彩 token）；输入法弹出时自动调整视口保持输入框不被遮挡；基于 `OnBackPressedCallback` 实现优先回退应用内历史、再返回服务器列表、最后退至后台的返回逻辑（兼容预测性返回手势）；外部域名跳转系统浏览器，附件支持文件选择器上传与 `DownloadManager`/系统打开方式下载，支持 WebView 渲染进程崩溃恢复、回复完成通知（在应用前台或刚切后台冻结前生效，点击直达话题）与 GitHub Release 更新检测。
- **可安装 PWA 与移动端响应式优化**：
  - 新增 `/manifest.webmanifest`、桌面与可遮罩（maskable）应用图标、`apple-web-app` 元信息、`viewport-fit=cover`、`interactive-widget=resizes-content`、侧边栏/弹窗/图片预览安全区留白，以及随应用内明暗模式和主题预设实时同步的 `<meta name="theme-color">` 。
  - 优化移动端排版与触控体验：Markdown 正文在移动端提升至 `16px` 并放宽行高，调整消息列表间距及侧边栏、下拉菜单、选择器、抽屉等组件的行高与间距，同时保持桌面端显示不变。
- **服务端与 Web 桥接**：
  - 扩展 `GET /api/health` 返回来自 `package.json` 的服务端 `version` 以供客户端做版本兼容检查；保持 `window.pikaNative` 完全可选，普通浏览器行为不受任何影响。

### Fixes

- **聊天断线重连**：修复流式重连失败后状态短暂锁住的问题，改为仅在 `submitted`/`streaming` 状态下视作已连接，确保 `clearError()` 重置状态后发现刷新能够正常重试断开的重连。
- **开发模式设置页重定向报错**：将 `/settings` 到 `/settings/general` 的重定向迁移至 `next.config.ts`，并让侧边栏设置按钮直接链接到 `/settings/general`，避免服务端与浏览器时钟偏差时 RSC `NEXT_REDIRECT` 触发 React Flight `performance.measure` 负时间戳报错。
- **客户端更新 SemVer 比较**：为 Android 与桌面 macOS 的更新检查补齐完整的 SemVer 预发布版本号比较逻辑（`native/shell-ui` 与 `Updates.kt`）。

### Dev

- 新增独立隔离的 `native/` pnpm 工作区（含 `@pika/shell-ui`、`pika-chat-desktop` 与 `@pika/mobile`），排除于根目录 `tsconfig.json` 与 Docker 构建上下文之外。
- 新增 `native` 工作区检查、Android Debug APK 编译验证及基于 PGlite 的集成测试 CI 任务。
- 扩展 `release.yml` 发布流水线：在构建多架构 Docker 镜像的同时，产出包含本地独立服务端的 Windows/macOS（Intel 与 Apple Silicon）/Linux 桌面安装包与签名版 Android APK；预发布标签不覆盖 Docker `latest`，且带连字符的 tag 自动标记为 GitHub Prerelease。

### Chore

- 统一英文与简体中文文案、应用图标及 Better Auth 配置中的品牌拼写为 **Pika Chat**。
- 在 `README.md` 与 `README.zh-CN.md` 中补充桌面端与 Android 客户端的安装、使用及开发说明。

## [0.4.2] - 2026-11-16

### Fixes

- **Markdown 控件与外链确认弹窗**：为 Streamdown 的代码块、表格、图片和 Mermaid 图表控件补充本地化文案，并让消息正文中的外链点击复用带动画与多语言支持的 `ExternalLinkDialog`。
- **弹窗底部与操作按钮**：统一 `AlertDialogFooter` 的扁平样式以对齐常规弹窗，并将用户创建、服务商配置及搜索服务商表单中的提交按钮移入 `DialogFooter`、统一按钮尺寸。
- **划词复制消息正文**：修复拖选超过消息末尾时，复制结果末尾多出空行的问题。

## [0.4.1] - 2026-11-16

### Fixes

- **话题标题**：新话题的标题现在与首条回复并行生成，侧边栏在标题生成后即时更新，不再一直显示默认标题直到切换页面。
- **标题与翻译提示词**：在弱化或忽略系统提示词的模型上，标题生成与消息翻译不再直接回答消息内容。推理模型生成标题时获得更大的输出预算与更长的超时，不再回退为截断的消息文本。

### Chore

- **共享 Provider 标注**：模型选择器中共享 provider 分组改为标注「（共享）」，不再显示分享者名称。

## [0.4.0] - 2026-11-15

### Highlights

- **服务端托管生成**：服务端一旦接受发送、重新生成或编辑请求，回复就不再依赖浏览器存活。切换话题、刷新、关闭标签页乃至退出登录，生成都会在服务端继续；回来时恢复同一次回复及其实时状态与停止按钮，而不是重新调用模型。主动停止或删除话题/助手仍会取消生成。
- **单条消息 Token 统计**：每条助手回复显示输入/输出 Token 与输出速度；悬停或点按可查看缓存命中 Token、命中率、首 Token 延迟及总耗时。

### Feats

- **后台生成与恢复**：
  - 文本与图片回合作为服务端任务运行，不受客户端断开影响；关闭标签页不再断开上游 provider（取代 0.3.3 的「客户端断连即断开 provider」行为）。
  - 返回话题时，已完成则展示最终结果；仍在生成则恢复已累积的正文、思考、工具状态、引用并接续实时流式。没有浏览器在线时也会生成话题标题。
  - 重复提交与重连绝不会重复执行同一次生成；提交确认丢失时可凭请求 ID 找回任务。服务端保证同一话题只有一个活跃回合，不同话题可并行生成。
  - 部分输出定期保存检查点。服务端重启后，运行中的任务以已保存内容标记为中断（不会静默重跑），停止中的任务收尾为已停止，排队任务继续调度。
  - 订阅、查询、停止均校验账号归属；退出登录会结束客户端订阅并清除账号相关本地状态，重新登录后可恢复任务。
  - 不新增部署组件：沿用现有 Node + PostgreSQL，无需额外配置。
- **消息用量统计**：
  - 按每次模型调用采集用量，TPS 不含首 Token 延迟与客户端工具执行时间；移动端行内仅显示 TPS。
  - OpenAI 兼容接口的缓存命中从原始 usage 读取（`cached_tokens`、`prompt_cache_hit_tokens`）；未上报缓存的 provider 隐藏缓存行而非显示 0。

### Fixes

- **模型厂商图标**：由其他厂商目录 provider 托管的模型（如 Azure/Vertex 上的 Claude、阿里云上的 DeepSeek）现在显示模型自身厂商图标而非托管方图标；已有目录数据会自动回填。
- **重连死循环**：聊天不再反复重试已被服务端拒绝的重连。

### Dev

- 升级 `ai` 至 7.0.170、`@ai-sdk/react` 至 4.0.174，以支持流中段恢复。
- 精简冗余的生成相关测试，并新增共享集成测试工具。

## [0.3.3] - 2026-10-21

### Highlights

- **离开话题不打断回复流式**：回复生成途中切换话题，不再面对一个之后突然填满的空视图——流在后台持续输出，切回话题时直接续上仍在累积的回复与实时流式状态。后台仍在输出的话题会在侧边栏显示转圈标记。

### Feats

- **后台流式恢复**：
  - 会话级聊天池为每个话题保有一条活跃连接：切走不再丢弃进行中的回复，切回时即刻展示已累积的文本与实时状态，无需等待历史重新拉取。
  - 在后台完成的流会先持久化并预取，下次访问时完整对话已经就绪——不会再闪过陈旧或空白的会话。
  - 侧边栏对任何有后台流式（发送或重新生成）的话题显示转圈指示。
- **客户端断连即断开 provider**：刷新页面或关闭标签页现在会立即断开上游 provider 连接，不再让服务端继续跑完（并为）一个无人阅读的流付费。断开前的部分内容仍照旧持久化。
- **流式渲染性能**：高频流式分片合并为约 20fps 更新，消息行组件记忆化——健谈的 provider 不再能让每个分片都触发整列表重渲染（及 markdown 重解析）。

## [0.3.2] - 2026-10-20

### Highlights

- **就地编辑用户消息并重新生成**：已发送的用户消息现在可以直接在消息列表中编辑——文本与附件均可修改。发送编辑后，该用户消息会生成一个可切换的新版本，并自动触发下方助手回复的重新生成（同样产生可切换的新版本）。

### Feats

- **用户消息编辑**：
  - 用户消息操作区新增铅笔图标按钮与「编辑」菜单项（移动端走点按显现路径，不依赖 hover）；助手消息无编辑入口。
  - 就地编辑器预填当前版本文本，展示当前版本的附件 chip（可删除，新增附件复用输入框的上传/校验/配额管线），底部提供「取消/发送」；取消不产生任何服务端写入。
  - 发送编辑不修改原消息：编辑内容作为**同一版本组的新版本**写入（事务化切换 `is_selected`），版本切换器首次在用户消息上可用。
  - 编辑发送后自动触发重新生成，使用输入框**当前选中**的模型/助手/搜索模式/推理档位（与「重新生成」按钮行为一致）；新的助手回复进入下方既有回复的版本组（无既有回复则开新槽位），并立即出现思考微光占位。后续消息不会被截断。
  - 服务端：现有重新生成端点接受可选 `edit` 负载；编辑提交的附件先经 `resolveOwnedFileParts` 归属校验再持久化新版本——若后续流式失败，用户编辑保留，助手侧按既有语义落一个失败版本（与重新生成失败一致）。
  - 压缩锁定区内的消息禁止编辑；任一流式进行中编辑入口禁用；无文本且无附件的空内容禁止发送（与输入框规则一致）。
- **分路由文档标题**：设置、登录注册、助手等页面通过路由元数据获得独立的浏览器标签页标题，聊天视图会让标签页标题与当前话题标题保持同步。

### Fixes

- **消息组位置稳定性**：消息组的展示位置改由新增的不可变列 `group_created_at` 锚定，不再依赖某个版本自身的 `created_at`——删除组内最早版本不再导致整组位置移动，对空槽位重新生成也会回到原位置，而不是跳到话题末尾。
- **删除版本导致整行重挂载**：删除非最终版本时，消息组行不再被卸载重挂载，保留进行中的 UI 状态。
- **滚动条拖拽与跟随滚动冲突**：按下滚动条（拖动或点击轨道）现在会解除流式跟随滚动锁定，拖拽途中视图不再被异步内容增长拉回底部。

## [0.3.1] - 2026-10-11

### Fixes

- **环境变量容错**：可选环境变量（`S3_BUCKET`、`S3_ENDPOINT`、`FILE_STORAGE_DIR`、`FILE_UPLOAD_MAX_MB` 等）的空赋值（`VAR=`）现视为未设置，不再导致启动校验崩溃；`S3_DIRECT_ACCESS` 除不设置外，也接受 `0`/`false` 作为显式关闭。拼写错误的值仍会在启动时快速失败。

## [0.3.0] - 2026-10-07

### Highlights

- **聊天内生图与图片编辑**：在会话中选中生图模型即可直接生成图片——适配 OpenAI 兼容 `/images/generations` 与 `/images/edits`、Gemini 原生 `generateContent` 以及 Seedream 多参考图融合；支持携带参考图进行图生图编辑，生成的图片可通过「编辑这张图」快捷入口一键回传继续创作。
- **全局搜索命令面板**：任意页面按下 `Ctrl+K` / `Cmd+K` 唤起居中弹窗，对话题标题与消息正文做全文检索，支持纯键盘导航、匹配词高亮、消息级跳转定位，以及话题内上一条/下一条命中导航。
- **用户级默认模型**：新增「默认模型」设置页，可为聊天、标题生成、上下文压缩、翻译四个用途分别配置默认模型；偏好模型失效时静默回退，不阻塞操作。

### Feats

- **聊天内生图**：
  - `outputModalities` 包含 `image` 的模型（catalog 自动填充或手动覆盖均生效）自动识别为生图模型，并在模型选择器中展示醒目标识。
  - 独立非流式生图旁路：`openai-compatible` → `POST /images/generations`；`google` → `generateContent`（`responseModalities` 含 IMAGE）；`claude` 明确报错拒绝。
  - 内置按模型家族维护的静态能力表，驱动尺寸/分辨率档位、生成数量与质量选项；厂商 400 错误原文透传给用户。
  - 生成图片复用附件管线落库（存储、配额、归属校验一致），作为 assistant 消息的 file part 内联渲染。
  - 支持重新生成（复用版本组机制产生新版本）与生成中途停止（消息标记 stopped）。
  - 生成图片自动以模型名与时间戳命名；生图消息隐藏复制与翻译操作。
- **图片编辑（图生图）**：
  - 生图模式下可直接附加参考图，或在生成图缩略图与预览弹窗中点击「编辑这张图」，将已有图片作为引用附件载入输入框，无需重新上传。
  - 适配层：Gemini 前置 `inlineData` parts；OpenAI 兼容按家族能力分流至 multipart `/images/edits` 或 Seedream 风格 `/images/generations` 的 `image` 参数。
  - 服务端在创建话题前完成分级校验：`image.attachmentUnsupported`（模型不支持图像输入）、`image.tooManyReferences`（参考图超上限）、`image.referenceNotImage`（非图片附件）。
- **页内图片预览**：新增共享预览弹窗，支持缩放、平移与上一张/下一张浏览，消息列表与文件管理页通用。
- **用户级默认模型偏好**：
  - 新增独立设置页 `/settings/models`，提供聊天、标题、压缩、翻译四个槽位，落库至 `users.model_preferences`（JSONB），经 `GET/PATCH /api/account/model-preferences` 读写并在保存时校验模型可用性。
  - 聊天模型解析链升级为「话题上一条消息模型 → 助手默认模型 → 用户默认聊天模型」；偏好模型被删除或禁用后静默回退到现有行为。
  - 标题生成、消息翻译、手动与自动压缩均遵循各自槽位的偏好模型。
- **全局搜索**：
  - 侧边栏全文搜索覆盖话题标题与消息正文（Postgres `ILIKE` 精确匹配 text part、仅命中已选中版本、严格归属隔离、摘要围绕匹配词开窗）。
  - 命令面板弹窗经 `Ctrl+K` / `Cmd+K` 或侧栏搜索入口唤起：结果分组展示、↑/↓ + Enter 纯键盘操作、匹配词以当前主题 `--primary` 高亮。
  - 消息命中深链（`?m=<groupId>`）滚动定位并闪烁高亮目标消息后自动抹除参数；浮动 `k / n` 控件支持同话题命中间往复定位，无需反复打开弹窗。
- **附件缩略图**：文件管理列表为图片行服务端生成缩略图。

### Fixes

- **时钟漂移导致的消息乱序**：统一所有 `chat_messages.created_at` 时间戳来源为 Node 应用进程时钟（`appendUserMessage` 新增显式 `createdAt` 参数，在请求处理早期一次性捕获），消除 Postgres 容器时钟与应用时钟漂移时用户消息与助手消息顺序倒置的问题。

### Dev

- **数据库迁移**：提交迁移 `0023_petite_liz_osborn.sql`（`users.model_preferences`）。

### Chore

- 刷新 README 功能描述并新增 UI 截图。

## [0.2.0] - 2026-09-17

### Highlights

- **长会话历史压缩**：当会话长度超出模型上下文窗口 80% 时自动生成滚动摘要并裁剪早前历史；支持在输入框手动触发压缩、消息列表中可折叠查看摘要正文，并对已压缩历史施加锁定保护。
- **消息多语言按需翻译**：消息操作区新增 8 种常用语言（中、英、日、韩、法、德、西、俄）一键按需翻译，基于单版本持久化 JSONB 缓存，完美保留 Markdown 排版并打通引用角标溯源。
- **预设主题与偏好落库**：新增 6 款精选预设主题（墨纸、石墨、深海、森林、蔷薇、罗兰）与配套明暗色系，服务端直出 SSR 消除闪烁，全站主题偏好落库持久化。
- **服务商快捷启停与模型检索**：服务商配置支持一键启用/禁用开关；新增模型对话框支持关键字模糊搜索与已添加锁定。
- **简短前缀 URL 标识符**：将助手与话题的地址栏链接由 36 位长 UUIDv7 升级为紧凑的 `agt_` / `tpc_` Base62 短标识符，链接更简洁清爽。

### Feats

- **会话历史压缩**：
  - 自动触发：当有效上下文估算超出当前模型上下文预算的 80% 时，自动将早前已选版本历史压缩为滚动摘要并注入系统指令层。
  - 手动触发：Composer 底部操作栏新增压缩按钮（`ListCollapseIcon`），伴随消息列表末尾的闪动状态提示。
  - 标记与可折叠面板：消息列表中在压缩边界处渲染分隔条，点击可顺滑展开/收起服务端持久化的 Markdown 摘要正文（默认折叠）。
  - 版本组边界对齐：边界基于版本组（`summary_up_to_group_id`）对齐，切换历史分支不会导致历史重送或边界丢失。
  - 压缩区安全锁定：已压缩消息自动隐藏删除与重新生成按钮，接口层面拦截并返回 409 `message.compressedLocked`。
  - 重新生成对齐：重新生成边界之后的消息时自动复用已持久化摘要，避免冗余消耗模型调用。
- **消息按需翻译**：
  - 8 种目标语言支持：内置简体中文、English、日本語、한국어、Français、Deutsch、Español、Русский，使用原生自标签展示。
  - 单版本独立持久化：在 `chat_messages.translations` 字段以 JSONB 按语言键增量合并缓存，跨设备重载秒开且零模型开销。
  - 可折叠译文卡片：在消息气泡下方渲染独立的折叠卡片，自动将消息关联的搜索引用信息透传至 Markdown 解析管线，译文中的 `[n]` 依然能正确渲染为可交互的引用来源标签。
  - 流畅状态交互：翻译执行期间提供渐变闪烁骨架提示，支持多语言并发翻译与防重复点击保护。
- **预设主题与偏好落库**：
  - 新增 6 款经过精细调色的预设主题，覆盖多种冷暖明暗基调。
  - 润色中性默认主题，优化暗色渐变质感与边框温润度。
  - 用户主题模式与预设落库持久化至 `users.theme_mode` 与 `users.theme_preset`，根布局在 SSR 阶段直接注入 `data-theme` 属性，彻底消除客户端水合闪烁。
  - 设置页面增加直观的预设色板选择卡片；侧边栏模式切换无缝联动。
  - 新增 `scripts/check-theme-tokens.mjs` 校验脚本，确保全套 CSS Token 覆盖率。
- **服务商与模型管理优化**：
  - 服务商配置新增启用/禁用开关（`provider_configs.enabled`），关闭后模型立即从全局选择列表中隐藏并受服务端鉴权拦截。
  - 模型发现弹窗（`DiscoverModelsDialog`）支持子串实时过滤，已添加模型直观锁定置灰。
- **紧凑前缀短标识符**：
  - 助手（`agt_`）与话题（`tpc_`）采用 12 位 Base62 短 ID，通过 `insertWithShortId` 插入并内置唯一碰撞重试保护，保持 URL 清爽整洁的同时全量兼容历史 UUIDv7 数据。
- **联网搜索与时效感知增强**：
  - 透传搜索服务商（Exa / Tavily）返回的发布日期（`publishedDate`），在搜索卡片直观显示并引导模型感知信息时效性。

### Fixes

- **多引用标记聚合切分渲染**：修复模型输出 `[3, 5]`、`[1、2]`、`[2，4]` 等聚合引用语法时被渲染为普通文本的问题，现统一切分为独立的连续可交互引用角标。
- **模型当前日期动态锚定**：统一通过 `buildChatInstructions` 向大模型注入客户端本地时区与当前公历日期，杜绝时间敏感提问中大模型因知识库截止时间导致年份倒退（如 2026 年检索 2025 年信息）的问题。
- **输入框图标按钮可访问性统一**：为 Composer 内所有图标操作按钮统一部署对等的 `aria-label` 与 `title` 提示属性。

### Dev

- **聊天组件原语抽象**：新增通用折叠原语 `CollapseBlock`，统一翻译块与压缩摘要面板的无障碍动画实现；新增 `shimmer.ts` 集中管理闪动骨架屏样式。
- **模型可用性门校验单点化**：抽象 `requireModelForActor`，消除 chat、regenerate 和 compress 路由之间的冗余校验逻辑。
- **数据库增量迁移**：新增迁移文件 `0021_good_luke_cage.sql`（消息翻译 JSONB 列）与 `0022_aberrant_mercury.sql`（话题摘要字段）。

### Chore

- 增加 MIT 开源许可协议文件（`LICENSE`）。

## [0.1.1] - 2026-09-15

### Highlights

- **反向代理与多地址访问支持**：采用通用环境变量 `APP_URL` 替代底层 `BETTER_AUTH_URL`，新增 `APP_TRUSTED_ORIGINS` 支持多域名与局域网跨域信任，并启用代理标头信任，彻底解决两步验证 403 `INVALID_ORIGIN` 报错。
- **Docker Compose 编排体系优化**：拆分提供全栈一体化、独立应用与本地开发三套 Compose 方案，支持分立式 PostgreSQL 环境变量配置与容器参数化。

### Feats

- **规范化应用基准 URL 与多 Origin 信任**：
  - 全工程采用 `APP_URL` 作为站点公网基准访问地址，屏蔽底层认证框架实现细节。
  - 增加 `APP_TRUSTED_ORIGINS` 环境变量，支持以逗号分隔配置多个受信任来源（局域网 IP、自定义端口、备用域名等）。
  - 在 Better Auth 中开启 `advanced.trustedProxyHeaders: true`，自适应识别 Nginx、Caddy、Traefik 等反向代理转发的 `X-Forwarded-Host` 和 `X-Forwarded-Proto`。
  - 彻底清除历史遗留的局域网 IP 硬编码。
- **支持分立式 PostgreSQL 环境变量**：除完整 `DATABASE_URL` 外，新增支持通过 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 分立变量连接数据库，自动完成密码特殊字符 URL 编码。

### Fixes

- **解决两步验证 403 `INVALID_ORIGIN` 报错**：修复远程服务器部署或反向代理环境下开启 TOTP 2FA 时，因请求 Origin 与默认 localhost 白名单不匹配被拦截的问题。
- **Compose 容器命名冲突与参数化**：为 Compose 服务增加项目命名前缀规范，参数化端口与数据库连接配置。
- **消除测试时钟偏差偶发失败**：在消息测试种子轮次中使用数据库 `defaultNow()` 替代应用层时间戳，彻底消除系统时钟抖动引发的测试不稳定。

### Dev

- **CI 与自动化发布工作流**：引入自动化 GitHub Actions 测试与跨架构镜像构建发布流水线。
- **升级至 Node 24**：升级 CI Actions 运行时环境至 Node 24，并修复 Dockerfile buildx 构建警告。

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
