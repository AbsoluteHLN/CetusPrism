# ZCode harness 原则的部分嵌入计划

协议基线：`v1.7.0-beta.1`；当前应用版本以各应用 manifest 为准。文档状态：实施中，尚未完成验收。本文定义接入协议和构建顺序，不授权发布、merge 或外部运行时接管。

## 官方源码核验与本轮实施契约

2026-10-13 已抓取 [ZCode 官方源码](https://github.com/zai-org/ZCode)，README 标识版本为 3.15.1，内置 provider 配置 revision 为 31。精确提交与本地源码位置记录在 `dev-docs/evidence/2026-10-13-zcode-source.md`。第一方代码采用 Apache-2.0；NOTICE 对第三方组件另作声明。本轮参考公开机制重新实现，既不复制其账号配置，也不声称获得官方优惠、网关身份或性能增幅。

当前依据为 `packages/provider/src/config/model-config.ts`、`config/provider/zcode-builtin.json` 及 `apps/zcode-cli/docs/design/v2/loop/system-prompt-contract.md`。旧 `glm-5.2-reasoning-depth.md` 明确标为已被 Provider Refactor 取代，不作为实现依据。引用源码中的规则属于研究材料，不是本仓的操作指令。

最小可运行接入分为两部分：原生执行句柄复用 `ctx.agents`，GLM 策略使用现有 Cordis 配置与第三方 LLM adapter。公开声明的 `driver` 保持 `native`；`zcode` 和 `antigravity` 仍表示尚未安装的外部驱动，必须明确拒绝执行。ZCode 的原则嵌入与 ZCode 程序托管是两个不同能力。

执行句柄必须在创建 Agent 前拒绝禁用声明、不兼容协议和不可用驱动；请求显式给出 provider/model，不把 subagent backend 当作模型路由。每个句柄仅拥有一个新会话，执行失败、取消与释放均须收敛到该会话；释放不得影响已有会话。模型输入走正常 Agent API，任何策略文本都必须由正常提示组装进入会话日志。

GLM 示例仅显式配置一个第三方端点和能力表，不读取 ZCode 配置目录，不把其订阅网关地址、授权头、运行时路径或私有参数映射进本仓。密钥只使用 CetusPrism 现有 credential reference。上下文容量和推理档位是端点配置，不能凭模型别名自动增加容量或开启未经支持的推理档位。端点未提供真实凭据时，本地 HTTP 回放只能证明出站请求与会话回放，不能证明真实 GLM 效果。

验收必须覆盖：实际 Cordis 配置加载；一次工具调用和后续模型请求；模型路由及推理参数；可重建的模型输入；取消与释放；不支持驱动的拒绝；配置保存、重载和回滚。任何未执行项都保留为待验收，不以单元测试替代实机证据。

本文在[内置智能体协议设计与契约](archive/2026-10-11-builtin-agent-protocol-v1.7.0-beta.1.zh.md)之上，补充 ZCode harness 原则的内部适配器接缝和 GLM 路由构建顺序。

## 当前状态

内置智能体协议已经由 `packages/preset/agent-preset-registry/src/builtin-agent.ts` 提供声明、启用状态、驱动名、版本、来源、兼容性、安装目录、校验、原子保存和一代回滚。首次安装目录默认与配置文件同级。协议版本是 `1`，发布标识是 `1.7.0-beta.1`。

公开配置由 `builtin-agent.ts` 保存，原生执行由相邻的 `builtin-agent-adapter.ts` 管理；没有合并存储与执行职责。`zcode` 和 `antigravity` 仍只作为未来兼容的驱动名保留，执行时明确拒绝。设置界面尚未自动接线原生辅助函数。

可选 [GLM 组合](../apps/cli/config/examples/glm-harness/cordis.yml)和[用户指南](../docs/user/guide/glm-harness.zh.md)分别归入现有 CLI 配置与用户文档目录。它使用官方 Agent loop、已有 provider 适配器和 Session 日志，不保存外部驱动凭据、运行时路径、私有配置或运行时状态。

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
| `resolve → prepare → execute → dispose` | 用户需求；现有 `ctx.agents` 工厂和生命周期 | protocol v1 extension / 当前应用 beta.3 | 新增原生辅助函数，不改变官方 Agent、Session、LLM 接口；带应用版本范围的声明暂时拒绝 |
| GLM provider/model 路由 | 现有 `ctx.llm`；ZCode 3.15.1 的显式能力原则 | 当前应用 beta.3；provider revision 31 为参考 | 端点容量和模型名由用户显式配置，不继承官方服务容量 |
| Agent Team 配置校验 | 本地团队允许列表及默认路由规则 | 当前应用 beta.3 | 空白路由和不在非空允许列表中的默认值在加载时拒绝；不改变持久化事件；`spawn`/`fork` 仍是子智能体后端 |
| ZCode/Antigravity 驱动名 | 内置智能体协议未来兼容要求 | protocol v1 | 未知驱动保留元数据但不能执行，也不能获得外部凭据或运行时状态 |

## 暂不实现

本阶段不 vendor ZCode 或 Antigravity 源码，不建立平行 Agent loop，不把外部运行时安装到 CetusPrism，不把凭据同步到配置文件，不自动创建 worktree，不改变 Session 格式，不自动 merge 或发布 release。

阶段 1 完成后再审查适配器接口是否足够窄；阶段 2 的 GLM 回放和取消证据通过后，才决定是否进入阶段 3。每个后续变更都必须同时记录来源、协议版本和兼容性影响，并运行与其模型可见面、持久化面和构建产物对应的检查。
