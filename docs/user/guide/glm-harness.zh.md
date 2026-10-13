# GLM harness 组合

[English](glm-harness.md) | 中文

这个可选的 headless 组合将显式配置的 GLM 网关与原生工具、任务跟踪、会话持久化和基于证据的编码指导组合起来。它参考 ZCode 公开的模型配置和提示词原则，在 CetusPrism 内运行，不启动 ZCode。

## 配置与运行

使用支持 OpenAI chat completions、`low`、`high`、`max` 三档 `reasoning_effort` 和工具历史中助手 `reasoning_content` 的第三方网关。将覆盖配置中的 `baseURL` 改为网关文档给出的端点；示例中的 `.invalid` 地址是占位地址。将 `CETUS_GLM_MODEL`、`CETUS_GLM_CONTEXT_WINDOW`、`CETUS_GLM_MAX_TOKENS` 设为准确的模型标识和端点文档给出的容量。配置不会根据模型名称推测能力。网关采用其他参数格式时，应调整显式兼容字段。

通过现有凭据服务或启动环境提供 `CETUS_GLM_API_KEY`。覆盖配置只保存引用名称，不读取或同步 ZCode 的凭据、配置、账号或运行时文件。

从当前仓库启动已有 CLI profile：

```sh
pnpm dsh --profile headless --patch apps/cli/config/examples/glm-harness/cordis.yml "Inspect this project and report what you verified."
```

默认推理档位为 `high`。选择其他受支持档位时，应一起调整覆盖配置中的提供商能力列表和默认选择。已有提供商设置仍由模型设置页和正常 profile 配置编辑器管理；启用本示例时，其显式配置优先。Agent Team 的独立允许模型列表必须使用 `glm-harness` 提供商路由，不能填 `spawn` 或 `fork`。

## 兼容性与回滚

[覆盖配置](../../../apps/cli/config/examples/glm-harness/cordis.yml)使用已有插件，不改变 Agent、Session 或 LLM wire 接口。稳定指导通过正常系统消息进入日志，工具结果和提供商回放元数据走已有会话路径。本示例适用于 `headless`；Web 预设拥有自己的 persona，使用相同指导前需要作用域内的组合。

后续启动时去掉 `--patch` 即停止应用该组合。已有会话和提供商凭据仍然保留。独立的内置智能体配置存储支持校验保存和单代回滚，但不回滚外部提供商状态。

## 限制与来源

这是参考 ZCode 的原生策略，保留的外部 `zcode` 驱动尚未实现。生命周期实现和验证状态记录在[接入设计](../../../dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md)。本地协议测试不能证明 GLM 任务质量提升或所有网关均兼容；这些需要对选定端点进行带凭据的评估。

参考实现：[ZCode 模型配置](https://github.com/zai-org/ZCode/blob/main/packages/provider/src/config/model-config.ts)和[系统提示词契约](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/design/v2/loop/system-prompt-contract.md)，审查版本为 3.15.1、提供商 revision 31。该组合不 vendor 原文代码、私有配置或运行时。
