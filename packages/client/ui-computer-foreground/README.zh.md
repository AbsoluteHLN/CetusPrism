---
description: "dsh Web 客户端的会话级计算机使用前台策略开关：助手是否允许抢占目标窗口前台，读取 computerDelivery 投影、经 /foreground 命令写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-computer-foreground

[English](README.md) | 中文

## 概述

输入区工具行中的一个开关芯片，位于权限控件右侧，决定计算机使用类工具是否允许把目标窗口切到前台。禁止后，提供方会把前台投递请求改写为后台投递，助手操作应用时不再抢占用户焦点。

## 目录

- [注册内容](#what-it-registers)
- [开关行为](#the-toggle)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="注册内容"></a>
## 注册内容

- **座位** — 输入区工具行中会话级单座槽位 `conversation.input.computerDelivery`，由 [DeliveryToggle](src/client/DeliveryToggle.tsx) 组件占用，文案命名空间为 `computerForeground`。
- **字典** — `computerForeground` 命名空间：两个状态标签与提示说明，中英各一份。

`src/client/` 下的源文件：`DeliveryToggle.tsx` 及其 CSS module（画什么）、`locales.ts`（说什么）、`index.ts`（接线）。

<a id="开关行为"></a>
## 开关行为

芯片读取会话的 `computerDelivery` 投影视图，由[前台策略服务](../../computer-use/computer-use-policy/README.zh.md)产出；键缺失说明宿主未装配策略服务，芯片不渲染。可见标签描述当前状态（`允许抢前台` / `禁止抢前台`），`aria-pressed` 标记受限状态。点击经 `/foreground` 命令提交另一模式——与斜杠命令共用同一条写路径，推送的投影帧即唯一确认。提交失败会解除等待锁并保留当前显示状态，投影帧本就会纠正它。

输入区锁定（回合进行中或会话不可用）时芯片禁用，与权限控件一致。

<a id="模型体验"></a>
## 模型体验

无：本包在浏览器中绘制控件，不注册任何面向模型的内容。执行侧——每次工具调用读取策略——属于提供方包。

#### KV Cache 影响

无；开关只读会话投影、提交会话命令。

## 已知限制与延期工作

- 芯片只覆盖当前会话；新会话从策略服务的装配默认值出发。
- 宿主有投影但缺 `/foreground` 命令（组合错配）时表现为提交时大声报错，而非隐藏芯片；两者来自同一服务，装配正确的部署中不会出现。

### 开发备注

开关无状态：渲染推送的投影视图、提交一行命令，重挂载后不留任何状态，也不存在存储。**运行时不变量：** 不发布伴随物，因为芯片显示的每个事实都是投影帧或输入区锁定状态，二者各归其注册表所有，不存在能与芯片分叉的独立观察。
