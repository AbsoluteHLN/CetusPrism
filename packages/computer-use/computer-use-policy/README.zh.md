---
description: "会话级计算机使用前台策略（ctx.computerUseDeliveryPolicy）：计算机使用输入类工具是否允许抢占窗口前台，以一条会话事件存储、由提供方在每次工具调用时执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use-policy

[English](README.md) | 中文

## 概述

用这个包为每个会话提供一个由用户掌握的答案：计算机使用类工具是否允许抢占窗口前台？默认值保留提供方自身行为（优先后台投递，前台可用）；把会话限制为 `background-only` 后，每个提供方都会在执行前把前台投递请求改写为后台投递，自动化永远不会激活窗口。会话日志即存储：一次切换是一条事件，经重放跨重启保留，两个会话互不可见。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="使用本包"></a>
## 使用本包

与计算机使用提供方一同装配。遵循本策略的提供方在每次工具调用时读取一次 `modeOf(session)`；原生 Cua Driver 提供方在其驱动边界上执行。

### 何时选择

凡装配计算机使用提供方的组合都应装配本包，让用户在一处掌握前台决策。没有装配计算机使用工具时可以跳过——此时投影键缺失，客户端控件自动隐藏。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-computer-use-policy'
  config:
    defaultMode: allow-foreground
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defaultMode` | `allow-foreground` | 会话在 `/foreground` 覆盖之前运行的投递模式，加载时校验 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-computer-use-policy)是全部字段及其 JSDoc 的详尽来源。

### 切换会话模式

写路径是 `/foreground` 命令及其背后的 `setComputerUseDelivery(session, mode)`：切换恰好追加一条 `computer-use/delivery` 事件，对该会话的下一次计算机使用工具调用生效。UI 控件提交命令行；需要运行时切换的运行组合可直接调用写入函数。模型没有切换面：策略由用户掌握，提供方在自己的边界上翻译策略，执行拒绝以普通工具错误到达模型。

### 失败与恢复

`/foreground` 命令在不认识的模式上直接拒绝、不写日志；命令子插件只在命令注册表存在时激活，没有它投影照常工作。后台路由不被支持时由提供方拒绝（驱动自身契约：不自动改走前台重试），受限会话退化为一次上报的失败，而不是被抢走的前台。

-----
<a id="理解实现"></a>
## 理解实现

服务注册 `computerDelivery` 会话投影单元——状态是最近一条 `computer-use/delivery` 载荷或 null，客户端视图把 null 折叠到装配默认值上。`modeOf(session)` 是执行侧读取：投影状态，否则默认值。事件是 log-only（`sandbox/mode` 先例）：持久、可重放、不进入模型转录。`src/types.ts` 是纯类型出口：模式联合、客户端视图与两个投影映射声明；`src/client.ts` 为浏览器端聚合原样转发同一内容。

-----
<a id="延伸阅读"></a>
## 延伸阅读

- 提交 `/foreground` 的输入区开关在 Web 客户端：[@deepseek-ai/dsh-client-ui-computer-foreground](../../client/ui-computer-foreground/README.zh.md)。
- 执行侧提供方：[原生 Cua Driver](../../experimental/computer-use-cua-driver-native/README.zh.md)。

-----

<a id="模型体验"></a>
## 模型体验

无，投递策略是用户自持的会话状态：提供方在自己的边界翻译策略，执行拒绝以提供方普通的工具错误到达模型。

#### KV Cache 影响

无；本策略不向模型请求贡献任何内容。

## 已知限制与延期工作

- 执行按提供方逐个生效：忽略 `modeOf` 的计算机使用提供方不受限制；原生 Cua Driver 提供方目前是唯一的执行方。
- 新会话从装配默认值出发；没有跨会话的默认开关（部署配置是默认值的唯一来源）。

### 开发备注

**运行时不变量：** 不发布伴随物，因为本策略只有一个存储（经投影单元的会话日志）和一个读取形态（`modeOf`）；执行方观察到的投影状态与服务暴露的相同，不存在可以分叉的独立观察。
