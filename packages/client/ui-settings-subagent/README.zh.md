---
description: "dsh Web 客户端设置对话框中的智能体团队设置页：subagent 命名空间的委派深度与并行容量，以及 subagent-model-selection-settings 里 Agent 可选的模型，同一页一次保存。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

[English](README.md) | 中文

## 概述

打开**设置 → 智能体团队**，即可设置委派限制、授权子智能体模型，以及限制团队模型和默认模型。页面把 `subagent`、`subagent-model-selection-settings` 与 `agent-team` 收在一次保存之下；Host 服务其中任一命名空间时页面就存在，并只显示可用部分。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先在**设置 → 模型**配置提供方，再在本页启用模型选择并授权可用路由。保存后对新的顶层会话生效；现有会话及其后代保留已记录的授权。

**运行限制**把**最大递归深度**和**子智能体并行数量上限**并排放置，窄屏时上下堆叠；每个标签旁的信息按钮展开它的规则——深度是一张两行示例表，容量是计数口径——填了不在范围内的整数会阻止保存并在字段下说明。深度让位于工具自己的上限；容量统计同一主 Agent 下所有层级存活的子智能体，主 Agent 不计入。

**模型选择**把权限开关和精确的适配器路由一起暂存。开启时至少要选一条路由；关闭会保留已选路由以备后用。Host 已存储但没有适配器公布的路由留在**已保存但当前不可用**分组里并且仍可移除；加载失败的提供方会被报告而不隐藏其他提供方，加载失败时提供**重试**。

**团队模型限制**提供团队专属的允许列表和可选默认模型。所选路由仍须经过通用模型选择设置授权。团队列表为空表示不增加额外限制，不会关闭 Host 检查。团队服务在接纳新成员时读取当前策略；运行中的成员保留已记录的路由。

一次**保存**通过各自的命名空间写入有改动的部分，每次写入都以其草稿读取时的修订号作栅栏。各次写入相互独立：Host 拒绝的部分保留草稿并报告失败，其他部分照常落地；被更新的 Host 修订号超越的模型草稿会以冲突形式报告并要求放弃，而不是覆盖较新的路由。离开页面即丢弃所有草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧为浏览器模块提供 Loader 行。浏览器通过 `ctx.configForms.get` 绑定三个命名空间。`SubagentLimitsCardController`、`SubagentModelSelectionCardController` 与 `TeamModelRestrictionCardController` 分别管理草稿，`subagentCardFace` 将其组合进共享 `SettingsForm`。模型目录更新会刷新候选项，修订号变化保护草稿不被并发写入覆盖，连接重置会丢弃断线状态。页面通过 `ctx.configForms.whileServed` 监视三个命名空间并完成注册。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——运行限制部分渲染的设置表单模型与字段。
- [tool-subagent](../../subagent/tool-subagent/README.zh.md)——注册这两个命名空间的委派工具。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **目录只在三种信号下重读**——适配器变化、文档提交和重连；在这三者之外开始公布模型的提供方，要等下一次信号或点击**重试**才会出现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
