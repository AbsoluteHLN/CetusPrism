---
description: "Desktop task notifications for Web — a Windows toast when a background task's turn completes or fails while the window is unfocused; inert in a plain browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-notify

English | [中文](README.zh.md)

## Summary

This package raises a Windows toast when a task's turn ends while the user is not looking at the window, so a hidden or backgrounded CetusPrism still reports completions and failures. The desktop shell shows the toast through its `notify` bridge member; a browser surface without that bridge stays a no-op.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mounting the plugin needs no configuration. While a session's turn ends, one toast names the outcome — 任务完成 or 任务失败 — with the session's display title. The notification fires only when the document is unfocused: a window in the foreground already shows the result where it happened, and a minimized or tray-hidden window is the case this package exists for. Only sessions a user started notify; subagent turns end inside a parent task and stay silent, as do user-initiated ends (abort, interrupt, fork) and ends awaiting interaction (blocked). Task failure toasts appear for turns that ended in the `error` kind.

Clicking a toast does not focus the window; restore it from the taskbar or the desktop shell's tray icon.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The host Session Controller forwards `api-session/turn-ended(sessionId, kind)` for every session turn end; this package subscribes through `ctx.remote.$on` and resolves the toast through `turnEndedToast`, a pure decision function over the turn-end kind, the session's list row, `document.hasFocus()`, the `dshDesktop.notify` bridge member, and the locale-bound copy. The row lookup classifies the session: an unknown row or an `origin: "subagent"` row stays silent, so delegation inside a running task never toasts. Only `completed` and `error` kinds produce copy, through the `desktop.notify` locale namespace.

The desktop bridge's `notify` member forwards to the shell's `dsh_notify` command, which builds a `ToastGeneric` XML document and shows it under the app's registered AppUserModelID. Toast identity is registered per-user (HKCU `AppUserModelId` key with the display name) at shell setup, so an unpacked or portable launch still shows titled notifications.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-api-session-controller](../../api/session-controller/README.md) — the Session object layer and the forwarded-event face this package subscribes to.
- [CetusPrism desktop shell](../../../apps/electron/README.md) — the shell that injects the `dshDesktop` bridge, owns the tray, and shows the toast.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as toasts are a desktop presentation of an already-logged session event.

#### KV Cache effect

None; the package sends nothing to the model and reads nothing model-visible that is not already on the session log.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No toast activation** — clicking a toast does not focus the window; restoring stays a taskbar/tray action. WinRT toast activation would require an activation callback registration the shell does not carry.
- **English and Simplified Chinese only** — the `desktop.notify` namespace ships those dictionaries; other locales fall back through the locale plugin's chain.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The suppression rule lives in `src/client/notify.ts` as `turnEndedToast`; unit tests pin every silent case and both notifying kinds. The lane's specs stub `document` and `globalThis.dshDesktop` because the test environment has no DOM.

</details>

**Runtime invariant:** No companion is published; the Host forwards turn ends through the existing session-controller event stream, and the client decision is covered by pure-function and apply specs.
