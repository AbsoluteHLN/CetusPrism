# ZCode harness 原则的部分嵌入计划

版本目标：`v1.7.0-beta.1`。文档状态：提案。本文只规划接入协议和构建顺序，不授权发布、merge 或外部运行时接管。

本文在[内置智能体协议设计与契约](archive/2026-10-11-builtin-agent-protocol-v1.7.0-beta.1.zh.md)之上，补充 ZCode harness 原则的内部适配器接缝和 GLM 路由构建顺序。

## 当前状态

内置智能体协议已经由 `packages/preset/agent-preset-registry/src/builtin-agent.ts` 提供声明、启用状态、驱动名、版本、来源、兼容性、安装目录、校验、原子保存和一代回滚。首次安装目录默认与配置文件同级。协议版本是 `1`，发布标识是 `1.7.0-beta.1`。

协议目前不启动驱动，也不保存外部驱动的凭据、运行时路径、私有配置或运行时状态。`zcode` 和 `antigravity` 只作为未来兼容的驱动名保留。

## 接入契约

新增的内部适配器层只接收经过 `BuiltinAgentConfigStore` 校验的公开声明和调用方显式请求，并按以下生命周期运行：

```text
resolve → prepare → execute → dispose
```

`resolve` 根据驱动名和 protocol version 找到适配器；`prepare` 校验能力并生成一次执行句柄；`execute` 接收结构化输入并返回结构化结果；`dispose` 释放句柄、进程和临时资源。每个阶段都必须支持明确的失败和取消结果，不能静默回退到另一个驱动。

适配器返回的能力至少包括支持的协议版本、模型路由能力、上下文继承能力、工具能力和可取消性。适配器的私有状态只由外部驱动所有者保留在内存或其专属存储中；CetusPrism 配置文件只能保留公开声明。CetusPrism 不读取、复制或写入 ZCode/Antigravity 的 credentials、runtime、privateConfig 或等价字段。

## CetusPrism 中的职责映射

| 责任 | 现有所有者 | 嵌入规则 |
| --- | --- | --- |
| 选择启用的内置智能体 | `ctx.agentPresets` / `agent-preset-registry` | 只选择 `enabled` 声明，不读取驱动私有配置 |
| 保存和回滚公开配置 | `BuiltinAgentConfigStore` | 使用现有 schema version、备份和原子替换语义 |
| 解析 LLM provider/model | `ctx.llm` 和现有模型选择设置 | 复用完整 provider/model 路由；不把 subagent backend 当作 LLM provider |
| 子智能体执行 | `ctx.subagents` | 需要 fresh/fork/continuable 时使用现有 provider 能力 |
| 模型可见输入、输出和恢复 | Agent、Session 与既有扩展点 | 新增模型可见状态必须进入 Session 日志，遵守 `model-visible ⟺ logged` |
| GLM harness 增强 | prompt、tool、request waterfall、retry 等现有插件接缝 | 通过组合现有能力实现，不复制第二套 Agent loop |

GLM 的第一版接入是第三方 provider/model 路由加 CetusPrism 自有 harness 策略。策略可以组合提示词 section、工具能力、请求参数、失败重试和结构化输出，但不能写入 ZCode 凭据或运行时信息，也不能改变官方 Agent、Session、LLM wire 字段。

## 分阶段构建

### 阶段 1：适配器类型和 native 骨架

新增协议中立的适配器类型、能力校验、结构化错误和生命周期测试。native 适配器只验证 `resolve → prepare → execute → dispose`，不启动外部进程，不引入凭据存储，也不改变现有接口。

### 阶段 2：GLM 路由和 harness 策略

通过 `ctx.llm` 的 provider registry 接入 GLM。使用已修复的 Agent Team 路由解析规则：显式 `agentOptions` 优先，旧 `model` 使用 Lead provider，随后是配置默认值和策略要求下的 Lead 当前路由；allowlist 比较只针对完整 LLM provider/model。验证提示词、工具、取消、重试、Session 回放和子智能体继承。

### 阶段 3：外部驱动适配器

只有在取得并审查 ZCode/Antigravity 的公开协议、版本和许可信息后，才分别实现适配器。适配器通过公开能力声明和结构化请求接入；外部凭据、运行时安装、私有配置、子进程和状态由驱动所有者管理，不进入 CetusPrism 持久化面。

### 阶段 4：设置和回滚体验

设置界面只编辑公开声明和启用状态，调用现有校验、原子保存和回滚。未知驱动可以保留在配置中，但运行时必须显示结构化不可用原因。回滚只交换 CetusPrism 自有配置代际，不回滚外部驱动的私有状态。

## 兼容性与来源记录

| 项目 | 来源 | 版本 | 兼容性说明 |
| --- | --- | --- | --- |
| 内置智能体声明、持久化、校验和回滚 | 第三阶段需求；现有 `builtin-agent.ts` | protocol v1 / `1.7.0-beta.1` | 保留现有 JSON 字段和默认安装目录，不引入私有字段 |
| `resolve → prepare → execute → dispose` | 用户要求引入的 ZCode harness 原则 | protocol v1 extension，待实现 | 仅新增内部适配器接缝，不改变官方 Agent、Session、LLM 接口 |
| GLM provider/model 路由 | 现有 `ctx.llm`、模型选择设置和本轮 Agent Team 修复 | `1.7.0-beta.1` | 允许列表只比较 LLM 路由；`spawn`/`fork` 仍是子智能体后端 |
| ZCode/Antigravity 驱动名 | 内置智能体协议未来兼容要求 | protocol v1 | 未知驱动保留元数据但不能执行，也不能获得外部凭据或运行时状态 |

## 暂不实现

本阶段不 vendor ZCode 或 Antigravity 源码，不建立平行 Agent loop，不把外部运行时安装到 CetusPrism，不把凭据同步到配置文件，不自动创建 worktree，不改变 Session 格式，不自动 merge 或发布 release。

阶段 1 完成后再审查适配器接口是否足够窄；阶段 2 的 GLM 回放和取消证据通过后，才决定是否进入阶段 3。每个后续变更都必须同时记录来源、协议版本和兼容性影响，并运行与其模型可见面、持久化面和构建产物对应的检查。
