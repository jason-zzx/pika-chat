# 聊天内生图功能

## Goal

在聊天中选择生图模型即可直接生成图片：后端独立 image service 按 apiFormat 适配各厂商生图端点；生图能力识别复用现有 models.dev catalog 的 `outputModalities`；生成结果作为 assistant 消息的 file part 落库，复用现有消息 / 文件 / 配额 / 版本基础设施。

## Background（调研结论，已确认）

- 生图端点路径分歧真实存在但收敛：OpenAI 兼容 `/images/generations` 覆盖 OpenAI、火山 Seedream、阿里兼容模式及全部聚合网关；真正需单独适配的只有 Gemini 原生（`generateContent` + `responseModalities`）；Anthropic 无生图能力。
- models.dev 无参数档位数据（分辨率 / 数量），只有 modalities；参数能力表必须静态维护。
- 本项目 `provider_models.output_modalities` 已由 models.dev catalog 自动填充，且 `addProviderModel` 支持用户手动覆盖 → "是否生图模型"零新增基础设施。
- 消息 `parts` 已支持 file part（`/api/files/<id>`），生成图可复用同一路径落库与渲染。

## Requirements

### Must

- **R1 生图模型识别**：`outputModalities` 含 `image` 的 provider model 视为生图模型（catalog 填充或用户手动覆盖均生效，沿用现有 metadata 机制，不新增标记字段）。
- **R2 聊天内生成**：composer 选中生图模型并发送后，后端走非流式生图旁路（不进 streamText 管线），生成图片以 assistant 消息 file part 持久化并在消息流中内联渲染。
- **R3 格式适配**：
  - `openai-compatible` → `POST {baseUrl}/images/generations`
  - `google` → `POST {baseUrl}/models/{model}:generateContent`（`responseModalities` 含 IMAGE），解析 inlineData
  - `claude` → 不生图；选中 image 模型且 format 为 claude 时给出明确错误
- **R4 生成参数**：尺寸/分辨率（按内置能力表给档位）、数量 n、质量档（仅支持的模型家族）。能力表按模型名模式匹配；未知模型走保守默认 + 允许自定义尺寸文本透传；厂商 400 错误原文（通常含合法值列表）透传给用户。
- **R5 重新生成**：生图消息支持现有 regenerate（产生新版本，复用版本组机制）。
- **R6 存储与配额**：生成图片写入 file storage、建 files 行，ownership 归发起用户，计入存储配额；配额不足按现有 `file.quotaExceeded` 报错。
- **R7 中止**：生图进行中可停止（AbortController 中断上游请求），消息标记 stopped。
- **R8 失败处理**：生成失败产生 failed outcome 的 assistant 消息 + i18n 错误文案，上游错误细节沿用 provider-error 约定透传。

### Must（续）

- **R9 话题标题**：生图话题沿用现有标题链路（旁路响应携带 `data-topic` 数据块，前端触发点原样命中，标题用 title 偏好模型）。预期零改动，但必须验收验证。
- **R10 模型选择器标识**：生图模型在 model pick 中有可识别标识（图标/badge），数据复用 `outputModalities`。

### Won't（本期明确不做）

- 图生图 / 图片编辑（images/edits、Gemini 图像输入）——后续任务。
- 独立生图页面 / 画廊 / 批量工作台。
- 生图作为聊天工具（tool calling 自动触发）。
- claude format 的生图支持。
- 按次数的生图配额（仅复用现有存储配额）。

## Acceptance Criteria

- [ ] openai-compatible format 的生图模型（如 gpt-image-1.5 / Seedream）可在聊天中出图，图片作为 assistant 消息内联展示，刷新后仍在
- [ ] google format 的 Nano Banana 系列可在聊天中出图；返回的文本部分（如有）一并展示
- [ ] 尺寸/数量/质量参数在 UI 可选且按能力表约束；未知模型提供默认档位 + 自定义尺寸输入
- [ ] 参数非法时用户看到厂商返回的具体错误信息（含合法值提示）
- [ ] regenerate 对生图消息产生新版本，版本切换正常
- [ ] 生成图片计入用户存储配额，配额满时报 `file.quotaExceeded`
- [ ] 生成中点击停止 → 消息 stopped，不留半截图片
- [ ] claude format + image 模型 → 明确的不支持错误，不产生脏数据
- [ ] 生图话题自动起标题（走 title 偏好模型）
- [ ] 生图模型在模型选择器中有可识别标识
- [ ] 普通聊天模型全流程（流式、搜索、压缩、标题）无任何回归

## Decisions（已确认）

- 首发能力表范围：gpt-image 系 / dall-e 系 / gemini image 系 / Seedream 系 / qwen-image+wanx 系 + 默认兜底，不再扩。
- 附件 + 生图模型：前端隐藏附件按钮，服务端 400 `image.attachmentUnsupported` 兜底。
- 图生图/编辑：作为本期紧随后续任务（本期 image service / 能力表 / 旁路均按其复用设计），触发时机看上线后改图诉求。
