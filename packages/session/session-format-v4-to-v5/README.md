---
description: "Complete V4-to-V5 Session conversion and native admission: the header generation increase, an unchanged body, delivery generations, and refusal."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore supported released V4 Sessions as V5 without rewriting their stored generation. This page specifies the edge's transformation, preservation, and refusal, then separates native V5 admission. The conversion raises the header generation and keeps every event, coordinate, and reference unchanged. Persistence owns file reads and successor publication; this library owns conversion and target rules.

## Table of Contents

- [Use this package](#use-this-package)
- [V4-to-V5 specification](#v4-to-v5-specification)
- [Native V5 admission](#native-v5-admission)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

The [format catalog](../session-format-catalog/README.md) imports this edge directly, so a caller reads a stored V4 generation through `sessionFormatCatalog.createRestore()`. Reach for this library directly only when a caller needs the adjacent conversion itself, for example to advance one V4 header before publication.

### Entry point

```ts
import { sessionFormatV4ToV5 } from '@deepseek-ai/dsh-session-format-v4-to-v5'

const target = sessionFormatV4ToV5.migrateHeader({ version: 4, id: 'session', createdAt: 1, isSeeded: false, delegationDepth: 0 })
// target.version === 5
```

A V4 header that the released V4 rules reject throws; a converted header always carries version 5.

-----

<a id="v4-to-v5-specification"></a>
## V4-to-V5 specification

### Header and physical framing

The edge raises `SessionHeader.version` from 4 to 5 and preserves every other header field, including `id`, `createdAt`, `cwd`, `parentSession`, `isSeeded`, `origin`, `delegationDepth`, and `agentPreset`. The physical framing is unchanged: a V5 file keeps the released row layout, the `session` header record, and the canonical generation filename `session.v5.jsonl`.

### Body transformation

The body conversion is an identity. Every payload a released V4 writer emits is already a valid V5 payload, so the stage preserves each event's `type`, `seq`, `time`, and `data` byte for byte. It adds no event, removes none, rewrites no message, and remaps no reference.

The stored V4 generation already carries the widened `team/member` member phase, the optional team model-route fields, the qualified `user-question-reply` attribution kind, and the ordinary `team/message/broadcast`, `team/message/broadcast-delivered`, and `computer-use/delivery` events. V5 adds no new payload shape of its own, so no body rule depends on the generation number.

### Preservation and inheritance

The inherited cut is unchanged. An unseeded Session keeps an inherited count of zero; a seeded Session keeps the position of its last `session/end-seed` event carrying `data.inherited: true`, and the edge refuses a source whose marker disagrees with the count the source decoder reported.

### Delivery generations

A `session-log-deepseek/delivery-accepted` marker records the generation that wrote it. A stored V4 Session that already contains a generation-5 marker is refused, because a source generation cannot claim a newer target. A generation-4 marker stays historical after conversion, so only generation-5 markers own the active watermark, and a marker that names another Session is refused unless it is an inherited parent delivery. A marker claiming a generation above 5 keeps its recorded coordinates and stays inactive.

-----

<a id="native-v5-admission"></a>
## Native V5 admission

### Header

`assertReleasedV5Header` accepts exactly the released header fields and requires `version` to be the literal 5, `id` to be a nonempty string, `createdAt` and `delegationDepth` to be non-negative safe integers, `isSeeded` to be boolean, `cwd` to be absolute when present, `parentSession` and `agentPreset` to be strings when present, and `origin` to be `subagent` when present.

### Events

V5 adds no native admission rule. The released V4 row admission decides every V5 row unchanged, so developer messages, retired syntax, system-message fields, tool-role results, fork results, and message sources keep their released meaning. Unknown ignorable records keep their uninterpreted payloads, and an unknown required event type is refused.

### Validation entry points

`restoreReleasedV5Artifact` validates the complete artifact: the header, a dense event sequence, the inherited cut against the seeded end-seed marker, the known-event vocabulary, the released native admission, and the released lifecycle, catalog, and delivery relationships. The installed current Session package owns the common event envelope and message acceptance.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| Concern | Location |
|---|---|
| Physical framing and row admission | [src/codec.ts](src/codec.ts) |
| Header, artifact, and relationship validation | [src/validation.ts](src/validation.ts) |
| Header migration and body stage | [src/migration.ts](src/migration.ts) |
| Released V4 rules reused unchanged | [V3-to-V4](../session-format-v3-to-v4/README.md) |

The V5 codec reuses the released V2 physical framing and the released V4 row admission; it neither copies nor redefines them. The V5 rules reuse the released V4 header, developer, source, lifecycle, catalog, tool, fork, and syntax validators, and own only the generation-dependent delivery check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session format catalog](../session-format-catalog/README.md) — the build-static chain that owns historical readability.
- [V3-to-V4 specification](../session-format-v3-to-v4/README.md) — the preceding edge, whose transformations still apply before this one.
- [Session format version and release status](../../../docs/session-format-status.md) — the checkout writer and the accepted baseline.

-----

<a id="model-experience"></a>
## Model Experience

### Historical conversion

#### What the model sees

The conversion replays the recorded `Session` events unchanged. The recorded `team/member` member phase keeps its stored value, and the conversion adds no message content, tool call, or system prompt text.

#### Token effect

The conversion changes no request text or token-bearing data.

#### KV Cache effect

The conversion preserves the recorded event order and message identities, so a restored Session rebuilds the same prompt prefix.

## Known Limitations and Deferred Work

- The edge assumes a V4 source body that a released V4 writer produced. A hand-edited V4 file that violates the released V4 rules is refused rather than repaired.
- The edge preserves the source body, so a V4 file that already carries a generation-5 delivery marker is refused instead of being rewritten.
- The V4 prerequisite reading of child catalog facts still goes through the installed catalog, so a V5 reader interprets V4 child evidence with V5 rules.

<a id="known-limitations-and-deferred-work"></a>

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
