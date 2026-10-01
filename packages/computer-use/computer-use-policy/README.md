---
description: "The per-session computer-use delivery policy (ctx.computerUseDeliveryPolicy): whether computer-use input tools may take the window foreground, stored as one session event and enforced by providers per tool call."
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use-policy

English | [中文](README.zh.md)

## Summary

Use this package to give each session a user-owned answer to one question: may computer-use tools take the window foreground? The default preserves the provider's own behavior (background delivery preferred, foreground available); restricting a session to `background-only` makes every provider rewrite foreground delivery requests to background before execution, so automation never activates a window. The session log is the store: a switch is one event, it survives restart through replay, and two sessions never see each other's state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package beside a computer-use provider. Providers that honor the policy read `modeOf(session)` once per tool call; the native Cua Driver provider enforces it at its driver boundary.

### When to choose it

Choose it for every composition that mounts a computer-use provider, so the user owns the foreground decision in one place. Skip it when nothing mounts computer-use tools — then the projection key is absent and clients hide their controls.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-computer-use-policy'
  config:
    defaultMode: allow-foreground
```

| Field | Default | Meaning |
|---|---|---|
| `defaultMode` | `allow-foreground` | The mode a session runs under before a `/foreground` override, validated at load |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-computer-use-policy) is the exhaustive source for every accepted field and its JSDoc.

### Switching a session's mode

The write path is the `/foreground` command and the `setComputerUseDelivery(session, mode)` helper behind it: the switch appends exactly one `computer-use/delivery` event and takes effect on the session's next computer-use tool call. A UI control submits the command line; `setComputerUseDelivery` exists for runtime compositions that switch without a human command surface. The model cannot switch the mode — no tool or prompt path writes it.

### Failures and recovery

The `/foreground` command rejects an unknown mode without touching the log; the command child activates only when a command registry is composed, and the projection works without it. An unsupported background route refuses at the provider (the driver's own contract: no automatic foreground retry), so a restricted session degrades to a reported failure, never a stolen foreground.

-----
<a id="understand-the-implementation"></a>
## Understand the implementation

The service registers the `computerDelivery` session-projection unit — state is the last `computer-use/delivery` payload or null, and the client view folds the null over the composed default. `modeOf(session)` is the enforcing read: projection state, else the default. The event is log-only (the `sandbox/mode` precedent): durable and replayable, never in the model transcript. `src/types.ts` is the pure outlet: the mode union, the client view, and both projection-map declarations; `src/client.ts` re-exports the same content for browser aggregates.

-----
<a id="further-exploration"></a>
## Further Exploration

- The composer toggle that submits `/foreground` lives in the web client: [@deepseek-ai/dsh-client-ui-computer-foreground](../../client/ui-computer-foreground/README.md).
- The enforcing provider: [native Cua Driver](../../experimental/computer-use-cua-driver-native/README.md).

-----

<a id="model-experience"></a>
## Model Experience

None, as the delivery policy is user-owned session state: providers translate it at their own boundary, and an enforcement refusal reaches the model as the provider's ordinary tool error.

#### KV Cache effect

None; the policy contributes no model request content.

## Known Limitations and Deferred Work

- Enforcement is per provider: a computer-use provider that ignores `modeOf` is not restricted; the native Cua Driver provider is the only enforcing consumer today.
- New sessions start from the composed default; there is no cross-session default switch (the deployment config is the default's only home).

### Dev Note

**Runtime invariant:** No companion is published because the policy has one store (the session log through its projection unit) and one read shape (`modeOf`); enforcing providers observe the same projection state the service exposes, so no independent observation can diverge.
