---
description: "桌面任务完成提醒 —— 当后台任务的回合完成或失败且窗口未聚焦时弹出 Windows 系统通知；纯浏览器环境不生效。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-notify

[English](README.md) | 中文

## 概述

当用户没有注视窗口时（窗口最小化、驻留托盘或被其他窗口遮挡），本包在任务的回合结束时弹出一条 Windows 系统通知，让后台运行的 CetusPrism 仍能报告完成与失败。通知由桌面 Shell 的 `notify` 桥成员负责展示；没有该桥的纯浏览器环境不会做任何事。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

无需配置。任务的回合结束时，弹出的通知以「任务完成」或「任务失败」为标题、会话标题为正文。只有文档未聚焦时才会弹出：窗口在前台时用户本就看得见结果，而最小化或驻留托盘的窗口正是本包服务的场景。仅用户启动的会话会提醒；子代理的回合结束于父任务内部，保持静默；用户主动结束（中止、打断、分叉）与等待交互的结束（blocked）同样不提醒。失败的回合（`error` 类型）使用失败文案。

点击通知不会聚焦窗口；请通过任务栏或桌面 Shell 的托盘图标恢复窗口。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

宿主侧 Session Controller 为每个会话的回合结束转发 `api-session/turn-ended(sessionId, kind)`；本包通过 `ctx.remote.$on` 订阅，并由纯决策函数 `turnEndedToast` 依据回合结束种类、会话列表行、`document.hasFocus()`、`dshDesktop.notify` 桥成员与本地化词典解析出通知内容。会话行的缺席或 `origin: "subagent"` 都保持静默，因此运行中任务的内部委托不会打扰用户。只有 `completed` 与 `error` 两种类型产生文案，词典位于 `desktop.notify` 命名空间。

桌面桥的 `notify` 成员调用外壳的 `dsh_notify` 命令：外壳构造 `ToastGeneric` XML 文档，以应用注册的 AppUserModelID 展示。外壳启动时在 HKCU 注册表写入 `AppUserModelId` 键（含显示名），因此免安装或解包运行也能显示带应用名的通知。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-api-session-controller](../../api/session-controller/README.zh.md) — 本包订阅的会话对象层与转发事件面。
- [CetusPrism 桌面外壳](../../../apps/electron/README.zh.md) — 注入 `dshDesktop` 桥、持有托盘并展示通知的外壳。
- [Client package map](../README.zh.md) — 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无；通知只是已记录会话事件的桌面呈现。

#### KV Cache 影响

无；本包不向模型发送任何内容，也不读取会话日志之外的信息。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **通知不可点击** — 点击通知不会聚焦窗口；恢复仍需任务栏或托盘操作。WinRT 通知激活需要外壳尚未具备的激活回调注册。
- **仅英语与简体中文** — `desktop.notify` 命名空间只内置这两套词典；其他语言经 locale 插件的回退链处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

抑制规则集中在 `src/client/notify.ts` 的 `turnEndedToast`；单元测试钉住每一种静默情形与两种提醒情形。测试环境没有 DOM，因此测试会为 `document` 与 `globalThis.dshDesktop` 打桩。

</details>

**运行时不变量：** 不发布宿主伴生服务；宿主通过既有的 session-controller 事件流转发回合结束，客户端决策由纯函数与 apply 测试覆盖。
