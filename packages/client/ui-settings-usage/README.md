---
description: "Token usage statistics section in Web settings: corpus-wide token totals and a per-session table folded from the Session list's projections."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

## Summary

The **Usage** section in Settings answers "how much have I spent" from data the client already carries. It folds every visible Session row's `tokenUsage` projection (uncached input, cache reads, cache writes, output) and the `sessionStats` conversation figures into bucket totals, a model-time card, and a per-session table sorted by total tokens. The section makes no Remote calls of its own: the Session list store is the whole data path, so the panel converges on the same pushed updates the Session sidebar renders, and sessions the projection cache has not seen stay uncounted in the coverage line rather than being invented.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Open Settings and select **用量统计 / Usage**. Cards show input (with the cache split), output, the combined total, and cumulative model wall time with turn counts; the table ranks sessions by billed tokens and marks subagent rows. The panel reads only what the Session list store holds — no additional fetch happens on open.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `aggregate.ts` is the pure fold: `tokenUsage` buckets per session plus `sessionStats.turns`/`llmMs`, with rows sorted by total tokens. It consumes the Session list snapshot's `byId` rows and nothing else.
- `UsageSection.tsx` renders the aggregate; the zero-coverage case renders the empty state (no sessions have reached the model yet).
- Registration is one `settings.section` entry (`id: 'usage'`, nav icon in the shell); the inject face carries the Session list store. The Host mounts `@deepseek-ai/dsh-token-meter` and `@deepseek-ai/dsh-session-stats` (base composition), which is where the projection values come from.

<a id="further-exploration"></a>
## Further Exploration

- [token-meter](../../llm/token-meter/README.md) — the `tokenUsage` projection this section aggregates.
- [session-stats](../../session/session-stats/README.md) — the whole-log conversation figures.
- [Session list](../../api/session-controller/README.md) — how projection values travel to the client list.

<a id="dev-note"></a>
## Dev Note

The section is presentational: totals derive in `aggregate.ts`, which is the test surface for coverage and bucket arithmetic.

<a id="model-experience"></a>
## Model Experience

None, as the section reads Session-list projections and renders figures only; nothing reaches a model request or the transcript.

#### KV Cache effect

None; the section neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Cold sessions whose projection cache rows predate their last fold serve stale-or-absent values; a session opened once refreshes its row.
- Per-model breakdown needs a route-attributed fold; the current projections carry no model identity, so the table is per-session only.
