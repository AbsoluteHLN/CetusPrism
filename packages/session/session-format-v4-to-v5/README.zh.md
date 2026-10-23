---
description: "完整的 V4 到 V5 Session 转换与原生接入：头部代次递增、事件体不变、交付代次与拒绝规则。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 概述

在不改写已存储代次的前提下，把受支持的已发布 V4 Session 恢复为 V5。本页完整说明该迁移边的转换、保留与拒绝规则，再单独说明原生 V5 接入。转换只提升头部代次，事件、坐标与引用全部保持不变。持久层负责文件读取与后继发布；本库负责转换与目标规则。

## 目录

- [使用本包](#use-this-package)
- [V4 到 V5 规格](#v4-to-v5-specification)
- [原生 V5 接入](#native-v5-admission)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选择它

[格式目录](../session-format-catalog/README.zh.md)直接导入该迁移边，因此调用方通过 `sessionFormatCatalog.createRestore()` 读取已存储的 V4 代次。只有当调用方确实需要相邻转换本身时才直接依赖本库，例如在发布前推进一个 V4 头部。

### 最小入口

```ts
import { sessionFormatV4ToV5 } from '@deepseek-ai/dsh-session-format-v4-to-v5'

const target = sessionFormatV4ToV5.migrateHeader({ version: 4, id: 'session', createdAt: 1, isSeeded: false, delegationDepth: 0 })
// target.version === 5
```

被已发布 V4 规则拒绝的 V4 头部会抛出异常；转换后的头部始终携带版本 5。

-----

<a id="v4-to-v5-specification"></a>
## V4 到 V5 规格

### 头部与物理封装

该迁移边把 `SessionHeader.version` 从 4 提升到 5，并保留其余所有头部字段，包括 `id`、`createdAt`、`cwd`、`parentSession`、`isSeeded`、`origin`、`delegationDepth` 与 `agentPreset`。物理封装保持不变：V5 文件沿用已发布的行结构、`session` 头部记录，以及规范代次文件名 `session.v5.jsonl`。

### 事件体转换

事件体转换是恒等转换。已发布 V4 写入方产出的每个载荷本身已经是合法的 V5 载荷，因此该阶段逐字节保留每个事件的 `type`、`seq`、`time` 与 `data`。它不新增事件、不删除事件、不重写消息，也不重映射任何引用。

已存储的 V4 代次本身已经携带放宽后的 `team/member` 成员阶段、可选的团队模型路由字段、带限定的 `user-question-reply` 归因种类，以及普通事件 `team/message/broadcast`、`team/message/broadcast-delivered` 与 `computer-use/delivery`。V5 自身不引入新的载荷形态，因此没有任何事件体规则依赖代次编号。

### 保留与继承

继承切点保持不变。未播种 Session 的继承计数保持为零；已播种 Session 保留其最后一个携带 `data.inherited: true` 的 `session/end-seed` 事件位置，并且当来源标记与来源解码器报告的计数不一致时，该迁移边拒绝转换。

### 交付代次

`session-log-deepseek/delivery-accepted` 标记记录写入它的代次。已存储的 V4 Session 若已经包含声明第 5 代的标记，则被拒绝，因为来源代次不能声明更新的目标代次。第 4 代标记在转换后仍属历史标记，因此只有第 5 代标记拥有活动水位；除非是继承自父级的交付，否则声明其他 Session 的标记会被拒绝。声明高于第 5 代的标记保留其记录坐标并保持非活动状态。

-----

<a id="native-v5-admission"></a>
## 原生 V5 接入

### 头部

`assertReleasedV5Header` 只接受已发布的头部字段，并要求 `version` 为字面量 5、`id` 为非空字符串、`createdAt` 与 `delegationDepth` 为非负安全整数、`isSeeded` 为布尔值、`cwd` 出现时必须为绝对路径、`parentSession` 与 `agentPreset` 出现时必须为字符串、`origin` 出现时必须为 `subagent`。

### 事件

V5 不新增原生接入规则。每个 V5 行仍由已发布的 V4 行接入规则判定，因此开发者消息、退役语法、system-message 字段、工具角色结果、fork 结果与消息来源保持既有含义。未知可忽略记录保留其未经解释的载荷，未知必需事件类型被拒绝。

### 校验入口

`restoreReleasedV5Artifact` 校验完整产物：头部、稠密事件序列、继承切点与播种 end-seed 标记的一致性、已知事件词汇、已发布的原生接入规则，以及已发布的生命周期、目录与交付关系。通用事件信封与消息接入由已安装的当前 Session 包负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

| 关注点 | 位置 |
|---|---|
| 物理封装与行接入 | [src/codec.ts](src/codec.ts) |
| 头部、产物与关系校验 | [src/validation.ts](src/validation.ts) |
| 头部迁移与事件体阶段 | [src/migration.ts](src/migration.ts) |
| 原样复用的已发布 V4 规则 | [V3 到 V4](../session-format-v3-to-v4/README.zh.md) |

V5 编解码器复用已发布的 V2 物理封装与已发布的 V4 行接入规则，既不复制也不重新定义它们。V5 规则复用已发布的 V4 头部、开发者、来源、生命周期、目录、工具、fork 与语法校验器，只自行拥有依赖代次的交付检查。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Session 格式目录](../session-format-catalog/README.zh.md)——拥有历史可读性的构建期静态链路。
- [V3 到 V4 规格](../session-format-v3-to-v4/README.zh.md)——前一条迁移边，其转换在此之前仍然生效。
- [Session 格式版本与发布状态](../../../docs/session-format-status.zh.md)——工作树写入方与已接受基线。

-----

<a id="model-experience"></a>
## 模型体验

### 历史转换

#### 模型看到什么

转换原样重放已记录的 `Session` 事件。已记录的 `team/member` 成员阶段保留其存储值，转换不新增消息内容、工具调用或系统提示文本。

#### 令牌影响

转换不改变请求文本或任何承载令牌的数据。

#### KV 缓存影响

转换保留已记录的事件顺序与消息标识，因此恢复出的 Session 重建出相同的前缀提示。

## 已知限制与暂缓事项

- 该迁移边假定来源事件体由已发布的 V4 写入方产出。违反已发布 V4 规则的手工修改 V4 文件会被拒绝，而不是被修复。
- 该迁移边保留来源事件体，因此已经携带第 5 代交付标记的 V4 文件会被拒绝，而不会被重写。
- 子目录事实的 V4 前置读取仍经过已安装的目录，因此 V5 读取方以 V5 规则解释 V4 子证据。

<a id="known-limitations-and-deferred-work"></a>

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
