---
description: "The right Sidebar's computer-use control tab for the dsh web client: the newest captured desktop frame, the assistant's computer-action feed, and the run's stop gesture."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-computer

English | [中文](README.zh.md)

## Summary

Watch and control the assistant's computer use from the right Sidebar. The tab shows the newest captured desktop frame, the session's computer actions newest first with localized lines and durations, a live running indicator, and the same stop gesture the composer owns.

## Table of Contents

- [What it registers](#what-it-registers)
- [The feed](#the-feed)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `computer`, id `@deepseek-ai/dsh-client-ui-sidebar-computer`, band `builtin`, and one guide entry (order 35, its title and description from the `sidebarComputer` namespace, its glyph the shared personalization icon) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: the status header with the stop gesture, the newest captured frame, and the capped action feed. No chip-title registration: the registry's captured title is the label.

Source files under `src/client/`: `definition.tsx` (the type), `model.ts` (pure feed derivation from raw chat nodes), `view/ComputerBody.tsx` with its CSS module (what it draws), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="the-feed"></a>
## The feed

The body subscribes to the session-standard Chat hook — the same transcript source the conversation renders — and keeps the root tool calls whose name carries the `cua_driver_native__` wire prefix of the [native Cua Driver provider](../../experimental/computer-use-cua-driver-native/README.md). A running call shows as running; a settled call shows its localized action line, its duration when the paired call head is inside the loaded window, and an error state when its result is an error. A settled call whose head fell outside the loaded window cannot be attributed to computer use and is skipped.

Labels are pure functions of the wire tool name and its parsed arguments: a click names its element handle, coordinates, or process; typed text and set values truncate through the truncation copy; key presses name their chord; an unrecognized tool shows its own upstream name. Malformed argument JSON degrades the detail, never the row.

The status header shows the live dot and the state line from the same feed's running flag, and the stop button interrupts the session's current run through the Conversation `cancel` face — the composer's own gesture. The stop button follows the session's running state, not the feed's, so it stays enabled while non-computer work runs.

The newest image block across all settled computer-use results renders as the live frame, resolved through the Conversation image cache to a session-authorized URL; the panel never revokes, because the cache's entries live as long as the Session binding. The feed is capped at the newest 50 actions with a hidden count.

<a id="model-experience"></a>
## Model Experience

### Computer control panel

#### What the model sees

No model sees this UI directly. The panel reads the session-standard Chat hook, keeps root calls named with `cua_driver_native__`, and forwards `cancel`; the Cua Driver provider owns its tools, guidance, execution, and results.

#### Token effect

This UI adds zero model-input tokens: it contributes no prompt, tool schema, independent request, or model-visible result.

#### KV Cache effect

Reading and rerendering session events does not modify the request prefix. Tool execution and results stay owned by the provider packages, so this panel offers no cache guarantee.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The feed covers root calls named with the native provider's prefix only; the MCP-based Cua Driver provider uses a different tool namespace and gets no rows.
- The feed covers root calls only; a computer-use call dispatched inside another tool shows only in the transcript.
- The stop gesture interrupts the session's current run, not one computer action; cancellation does not undo input already delivered to an application (the provider's own contract).

<a id="dev-note"></a>
### Dev Note

The panel subscribes to two framework channels (the Chat standard hook and the session running flag) and owns one local fact, the resolved frame URL. There is no store and no invariant: nothing survives a remount, and every displayed fact is reconstructable from the session log.

**Runtime invariant:** No companion is published because every displayed fact — the feed, the running flag, the newest frame — is a pure derivation of session events already owned by the transcript targets, so no independent observation can diverge from the panel.
