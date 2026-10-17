---
description: "The Subagent settings page in the dsh web client's Settings dialog: delegation depth and capacity over the subagent namespace, and the models agents may choose over subagent-model-selection-settings, on one page with one save."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

English | [中文](README.zh.md)

## Summary

Open **Settings → Agent Teams** to set delegation limits, authorize subagent models, and restrict Team models and their default. The page groups `subagent`, `subagent-model-selection-settings`, and `agent-team` under one save; it exists while the Host serves any of them and shows the available sections.

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

Configure providers under **Settings → Models**, then enable model selection here and authorize the routes agents may choose. Saved authorization applies to new top-level conversations; existing conversations and descendants retain their recorded authorization.

**Limits** holds **Maximum recursion depth** and **Subagent parallelism limit** side by side, stacking on narrow screens; the information button beside each label discloses its rule — a two-row depth example, and the count that capacity bounds — and a draft that is not a whole number in range blocks the save and says so under the field. Depth yields to a tool's own maximum; capacity counts every live subagent under one main agent across all levels, the main agent excluded.

**Model selection** stages its permission switch and the exact adapter routes together. Enabling requires at least one selected route; disabling keeps the selected routes for later. Routes the Host stored but no adapter advertises stay listed under **Saved but currently unavailable** and remain removable; a provider that failed to load is reported without hiding the others, and a failed load offers **Retry**.

**Team model restrictions** adds a Team-specific allowlist and optional default model. Its routes must remain authorized by the shared model-selection setting. An empty Team list adds no further restriction; it does not disable the Host checks. The Team service reads the live policy when admitting a new teammate; running teammates retain their recorded route.

One **Save** writes dirty sections through their own namespaces, each fenced by the revision its draft read. The writes are independent: a section the Host refuses keeps its draft with the failure reported while the others land, and a model draft a newer Host revision superseded is reported as a conflict to discard rather than overwriting the newer routes. Leaving the page drops every draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half exposes the Loader row for the browser module. The browser binds the three namespaces through `ctx.configForms.get`. `SubagentLimitsCardController`, `SubagentModelSelectionCardController`, and `TeamModelRestrictionCardController` own their drafts; `subagentCardFace` combines them in the shared `SettingsForm`. Model catalog updates refresh the displayed candidates, revision changes protect drafts from concurrent writes, and connection resets discard disconnected state. The page registers through `ctx.configForms.whileServed` over all three namespaces.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the limits section renders.
- [tool-subagent](../../subagent/tool-subagent/README.md) — the delegation tools that register both namespaces.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The catalogue re-reads on three signals only** — adapter changes, document commits, and reconnects; a provider that starts advertising without any of them shows up on the next of those or on **Retry**.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
