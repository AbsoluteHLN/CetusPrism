---
description: "Web 设置中的用量统计分节：把会话列表投影折叠为全库 token 消耗与逐会话表格。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

## 概述

**用量统计** 设置页回答"花了多少额度"。它把每个可见会话的 `tokenUsage` 投影（token-meter 的未命中输入/缓存读取/缓存写入/输出四个分桶）与 `sessionStats` 会话指标折叠为总量卡片、模型耗时和按消耗排序的逐会话表格，并对子代理行打标。分节自身不发起任何 Remote 调用——会话列表存储就是全部数据路径，面板与会话侧边栏在同一推送上收敛；投影缓存未覆盖的会话只计入覆盖率，不会被臆造。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与搁置工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

打开设置中的「用量统计」分节。卡片展示输入（含缓存拆分）、输出、合计与模型耗时；表格按计费 token 排序列出各会话。数值来自 Host 端 token-meter 与 session-stats 投影经会话列表透出的值，冷会话与活动会话一并覆盖。

<a id="understand-the-implementation"></a>
## 理解实现

- `aggregate.ts` 是纯折叠：逐会话读取 `tokenUsage` 分桶并累加，另取 `sessionStats.turns/llmMs`；无 `tokenUsage` 值的行不计数，只体现在覆盖行。
- `UsageSection.tsx` 只做呈现：四张汇总卡（输入/输出/合计/模型耗时）、按总消耗排序的会话表（上限 50 行）、覆盖说明与空态。
- 注册路径：`ctx.sessions.list` 注入组件，`settings.section` 登记项（id `usage`）与 locale 字典各一条 effect。

<a id="further-exploration"></a>
## 延伸阅读

- [token-meter](../../llm/token-meter/README.zh.md)——本分节聚合的 `tokenUsage` 投影。
- [session-stats](../../session/session-stats/README.zh.md)——整段会话的轮次与耗时指标。
- [会话列表](../../api/session-controller/README.zh.md)——投影值如何随会话列表到达客户端。

<a id="dev-note"></a>
## 开发备注

分节是纯展示层：总量在 `aggregate.ts` 推导，该模块也是覆盖与分桶算术的测试面。

<a id="model-experience"></a>
## 模型体验

无，因为本分区只读取会话列表投影并渲染数字；不触及任何模型请求或转写。

#### KV Cache 影响

无；本分区不组装也不发送任何提供方请求。

## 已知限制与搁置工作

<a id="known-limitations-and-deferred-work"></a>

- 投影缓存行早于最近一次折叠的冷会话，取值可能缺失；打开一次会话即刷新。
- 按模型拆分需要带路由归属的折叠；现有投影不含模型身份，因此表格仅到会话粒度。
