---
description: "Choose an Agent’s tools, prompt sections and skills through declarative presets. One process can run several compositions. Failed definitions remain visible, while existing Agents retain the composition they already use."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-preset-registry

English | [中文](README.zh.md)

## Built-in agent protocol

The built-in agent protocol is introduced in v1.7.0-beta.1 through the exported `BuiltinAgentConfigStore` and validation helpers. It persists enabled declarations and a configurable install directory with atomic replacement and one-step rollback. Declarations carry only public driver metadata; credentials, runtime paths, and driver-private configuration are rejected. The design and compatibility record lives in [`dev-docs/archive/2026-10-11-builtin-agent-protocol-v1.7.0-beta.1.zh.md`](../../../dev-docs/archive/2026-10-11-builtin-agent-protocol-v1.7.0-beta.1.zh.md).

`resolveBuiltinAgent` and `prepareBuiltinAgent` provide a native, single-use lifecycle over `ctx.agents`. The caller supplies the provider/model route and may request a preset; a requested preset requires a mounted registry. Execution returns the Session events and turn endings observed until the whole Agent is idle, including errors and cancellation. It does not attribute those events to one message or equate idleness with success. Always dispose the prepared handle. Disabled declarations, external drivers, protocol mismatches, and application-version ranges that cannot be evaluated are rejected before creation. The [GLM composition guide](../../../docs/user/guide/glm-harness.md) describes a separate opt-in native strategy; no settings UI automatically invokes this helper.

## Execution backends

A backend owns the Agent lifecycle, the request scheduling and the tool execution. It is a separate dimension from the preset, which owns the prompt, the tool set and the runtime constraints, and from the model, which owns the provider, model and effort routing.

`AgentPresetRegistry.registerBackend()` is the one entry an external runtime uses. The adapter answers a probe — version, source, and whether CetusPrism can speak to it — and nothing else: CetusPrism stores no credential, private configuration or runtime file for it. That probe contract is the `BuiltinAgentBackendProvider` the registry registers. The `backends` Remote publishes the `AgentBackendCatalog`, DSH first, with each backend's version, availability and capabilities. DSH is always present and always ready; Pi and ZCode stay visible as unconfigured until an adapter registers, because the reason they cannot start a session is what the composer has to explain.

The composer chip lists the three backends. A backend that cannot start a session is refused with the reason the host published, rather than silently falling back to DSH.

## Summary

Choose an Agent’s tools, prompt sections and skills through declarative presets. One process can run several compositions. Failed definitions remain visible, while existing Agents retain the composition they already use.

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

### Minimal configuration

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    plugins: []
```

| Field | Default | Meaning |
|---|---|---|
| `default` | required | Preset ID used when none is requested |

The Web definitions come from the `dsh-web-app` bundle. Definitions are ordinary plugin rows; the registry neither scans directories nor accepts preset paths. The `selectedDefault` volatile field of the `agent-preset-registry` entry retains the user default, which new sessions resolve over the deployment `default`. A profile patch may still carry the retired `modeSelectionEnabled` field; the registry declares no such field and neither reads nor rewrites it.

The registry writes no declarations. The `read` Remote renders one declaration’s child list back as entry-list YAML (`!!js` conditions included) so a client can show what a preset composes; nothing accepts YAML back. A new preset or an override of a shipped one is a bundle patch: an `insert` of a `@deepseek-ai/dsh-agent-preset` row, or a patch keyed by that row’s id, installed into the profile with `plugin_manager`; Creator mode authors such bundles in conversation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each declaration eagerly creates a registry-owned scope and an in-memory Loader tree. Updating or removing a declaration retires its previous revision. Agents, children and temporary historical reads retain references; releasing the final reference disposes the retired tree. Plugin registrations inherit the preset scope, and the Agent scope’s parent link controls visibility. The Host continues to share the Agent loop.

A preset service provider and its consumers must share one `cordis:group` isolation realm. Entry-local isolation does not propagate through the Agent registration scope: ordinary Context lookup outside the group, including `agent.ctx`, still selects the Host realm. `agentPresets.serviceFor()` explicitly inspects the retained composition; it does not change ordinary service lookup.

Activation auditing checks imports, missing services and globally leaked services. Import failures, activation failures and leaks reject the mount. A row waiting for a Host service stays mounted, and every read and binding re-audits it after the Host Loader tree settles, so startup order does not decide the outcome. Failure prevents new bindings to that definition. Session logs retain the preset ID and blank-session selections; recovery after restart uses the current definition of that ID and rejects a missing definition.

`inspectCompositions()` reads all revisions retained by this registry; passing an Agent context selects its exact revision, or returns an empty list when it has no binding here. Each `AgentPresetInspection` contains a preset ID, detached active-module references with their resolution bases, and leaked-service names. Inspectors query the runtime service rather than a module-local mount table; the results contain no Loader trees or fibers. [composition-inventory.ts](src/composition-inventory.ts) defines these records.

| File | Responsibility |
|---|---|
| [index.ts](src/index.ts) | Registration, revisions and Agent bindings |
| [mount.ts](src/mount.ts) | Scoped plugin trees and activation auditing |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

### Preset selection

#### What the model sees

Nothing directly: the selected preset’s `plugins` own the model-visible tools and prompt sections.

#### Token effect

None from this package; each mounted `plugins` row declares its own tools and sections.

#### KV Cache effect

Existing Agents retain their plugins and prompts. New Agents build their prefixes from the current definition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Presets are not security sandboxes: YAML and plugins can execute Host code. A user override replaces the complete child list and does not automatically merge future changes to the builtin list. Old revision implementations are not retained across process restarts.
- Sessions bind to DSH in this build. The session-level backend binding — choosing a registered external runtime for the next session and recording it in the session log — is not part of it, so such a pick is refused explicitly instead of being recorded where nothing would honour it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
