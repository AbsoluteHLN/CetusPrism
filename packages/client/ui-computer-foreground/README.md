---
description: "Composer toggle for the session's computer-use delivery policy in the dsh web client: whether the assistant may take the window foreground, read from the computerDelivery projection and written through /foreground."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-computer-foreground

English | [中文](README.zh.md)

## Summary

A toggle chip in the composer tool row, right of the permission control, that decides whether computer-use tools may bring a target window to the foreground. When blocked, providers rewrite foreground delivery to background, so the assistant drives applications without stealing the user's focus.

## Table of Contents

- [What it registers](#what-it-registers)
- [The toggle](#the-toggle)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="what-it-registers"></a>
## What it registers

- **The seat** — the `conversation.input.computerDelivery` single session-scoped slot in the composer tool row, occupied by the [DeliveryToggle](src/client/DeliveryToggle.tsx) component with the `computerForeground` locale namespace.
- **The dictionaries** — the `computerForeground` namespace: the two state labels and the tooltip description, zh and en.

Source files under `src/client/`: `DeliveryToggle.tsx` with its CSS module (what it draws), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="the-toggle"></a>
## The toggle

The chip reads the session's `computerDelivery` projection view, produced by the [delivery-policy service](../../computer-use/computer-use-policy/README.md); a missing key means the host composes no policy service, and the chip renders nothing. The visible label names the current state (`允许抢前台` / `禁止抢前台`), and `aria-pressed` marks the restricted state. Clicking submits the other mode through the `/foreground` command — the same write path the slash command exposes — so both surfaces share one writer and the pushed projection frame is the one confirmation. A failed submit releases the pending lock and keeps the displayed state, which the projection frame would have corrected anyway.

The chip is inert while the composer is locked (a run is active or the session is unavailable), matching the permission control's behavior.

<a id="model-experience"></a>
## Model Experience

### Computer foreground policy

#### What the model sees

No model sees this UI directly. The toggle reads `computerDelivery` and submits `/foreground`; the [delivery-policy service](../../computer-use/computer-use-policy/README.md) owns the policy that consumers apply and the resulting tool behavior.

#### Token effect

This UI adds zero model-input tokens: it contributes no prompt, tool schema, independent request, or model-visible result.

#### KV Cache effect

Changing the toggle does not modify an assembled request prefix by itself. If the provider-side policy changes later behavior, that package and its consumers own those request effects; this package offers no cache guarantee.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The chip covers the current session only; new sessions start from the policy service's composed default.
- A host without the `/foreground` command but with the projection (a composition mismatch) surfaces as a loud submit error, not a hidden chip; the projection and the command come from the same service, so the mismatch cannot occur in a composed deployment.

<a id="dev-note"></a>
### Dev Note

The toggle is stateless: it renders the pushed projection view and submits one command line, so nothing survives a remount and no store exists. **Runtime invariant:** No companion is published because every displayed fact is the projection frame or the composer lock state, both owned by their registries, so no independent observation can diverge from the chip.
