---
description: "Run a small team of named agents in one session: durable messages between members and a shared task board, for deployments composing the experimental Team plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agent-team

English | [中文](README.zh.md)

## Summary

Run named teammates, exchange durable messages, and track shared tasks within one coding session. Messages and tasks survive crashes and reloads; resumed teammates receive queued messages. Mount `dsh-experimental-tool-agent-team` for model-facing tools and durable session storage for activation. The published experimental API carries no stability promise. Persistent-terminal compositions can show the caller's roster and tasks through `/team`.

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

Add this package to a composition when one agent should run a small team of named helpers in its own working directory, with messages and task state that survive crashes and restarts. It ships no tools of its own: mount it together with `@deepseek-ai/dsh-experimental-tool-agent-team` so the model can create teammates, message them, and use the task board.

With the persistent terminal profile, this plugin supplies the optional read-only `terminalTeamStatus` presenter for `/team`. The terminal owns the service definition; the presenter formats only the caller-visible roster and tasks without changing model selection or Session formats.

### When to choose it

Choose it when several agents must cooperate on one shared workspace and their roster, messages, and task state must survive crashes and restarts. Avoid it when teammates need separate working directories, when several processes must coordinate over one team, or when a task owner should be released automatically — none of those are supported. The team features need durable session storage to activate.

### Smallest working setup

<a id="smallest-working-setup"></a>

The smallest addition to an existing composition is durable session storage plus both Team packages:

```yaml
# smallest team setup — durable storage plus both Team packages
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-experimental-agent-team'
- name: '@deepseek-ai/dsh-experimental-tool-agent-team'
```

With the tools installed, the model does the rest on request — for example, "create a teammate named reviewer to check the diff", then "send reviewer the change summary". All limits are optional and validated at startup:

| Field | Default | Meaning |
|---|---|---|
| `maxMembers` | `16` | Maximum teammates a team may ever create, including failed ones |
| `maxTasks` | `256` | Maximum active tasks on the board |
| `maxPendingMessagesPerMember` | `64` | Maximum queued messages for one member |
| `maxMessageBytes` | `65,536` | Maximum size of one sent message |
| `disposalTimeoutMs` | `5,000` | Time allowed for shutdown cleanup |

Teams can enforce an additional LLM provider/model allowlist alongside the Host subagent allowlist and the separate `spawn`/`fork` backend selection. Configure the Team routes and optional default in the Team service:

```yaml
agentTeams:
  allowedModels:
    - { provider: native, model: deepseek-chat }
    - { provider: native, model: deepseek-reasoner }
  defaultModel: { provider: native, model: deepseek-chat }
```

An empty Team `allowedModels` list adds no Team-specific route restriction. Any route selected for a teammate—explicitly, through `defaultModel`, or to satisfy a nonempty Team allowlist—still requires the Host model-selection service to be enabled and the Host allowlist to admit it. A configured `defaultModel` must appear in a nonempty Team `allowedModels` list. When neither a Team default nor a Team allowlist is configured and no model selection is requested, the child inherits the Lead's route without Team model-policy selection. Calling the public `spawnTeammate()` API directly follows these same checks. The explicit `agentOptions` route has priority, while the legacy `model` field uses the Lead's LLM provider. The `provider` argument that selects `spawn` or `fork` is separate from LLM route allowlists. The selected model and reasoning effort are persisted with the roster member, and the complete route is passed to the child runtime through `agentOptions`.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-agent-team) is the exhaustive source for every accepted field and its JSDoc.

### Teammates

Ask the Lead to create a teammate: give it a unique lowercase name such as `reviewer` and describe its job. A teammate starts fresh with no memory of the Lead's conversation, or as a fork that inherits the Lead's completed turns; the creation request chooses which. Teammate names are permanent — even a teammate whose creation failed keeps its name, and no name is ever reused.

The roster shows every member with its role (`lead` or `teammate`) and current status: `running`, `inactive` (no turn is executing, whether loaded or stored), `provisioning`, `dormant`, or `failed`. A member that is not loaded receives its messages when it wakes.

Only the Lead can create teammates or interrupt them.

### Agent profiles

A deployment can declare named agent profiles — reusable identities rather than one-shot names. A profile carries an `id`, the member `name` it takes, what it is for, the backend it runs under, an optional model route, optional reasoning-effort ids it may use, and an optional agent preset.

A profile is a deployment fact, not a session fact: the same profile can be instantiated in any Team, and the instance records the profile it came from, so a later session can address the identity by id instead of rediscovering it. Asking for a profile that is not declared is refused with `TEAM_PROFILE_UNKNOWN`; asking for one while naming a different member name, backend, or model route is refused with `TEAM_PROFILE_CONFLICT` rather than silently preferring one of the two.

### Dormancy and reuse

The Lead can release a resident teammate. Its runtime is stopped, but its durable member record stays and its status becomes `dormant`, which is a state of its own rather than a synonym for "inactive": the identity is still there and still reusable. A resume cold-resumes the persisted child Session and submits the new task, so the member keeps its identity and its history; a member that cannot be resumed reports why instead of silently starting over.

### Ranges

A Team can place three independent ceilings on its members: the reasoning efforts they may use, the execution backends they may run under, and the agent presets they may run under. Every ceiling is a set of exact names — never an interval — and an empty set means the Team places no ceiling of that kind. A request outside a ceiling is refused with a typed error naming the offending value. A profile's own effort list narrows the Team ceiling further; the model-advertised efforts and the Host-authorized model list still apply on their own.

### Group messages

A member can address several members at once. One durable broadcast record holds the content once and names every target; each target keeps its own delivery edge, its own de-duplication, and its own pending-message allowance, and the per-target ceiling is charged per expanded target. A broadcast that reached a member but was never recorded waits in the same durable queue as an ordinary message and is retried the same way. Broadcasting to yourself is refused, and a broadcast with no target is refused.

### Messages between teammates

Any member can send a message to any other member or to the Lead. A live member receives it immediately; an offline member's messages queue and arrive when it resumes. Messages are never lost and never delivered twice.

Every message uses Steer: a running target receives it at the nearest step boundary; an inactive target starts a turn if loaded or cold-resumes otherwise. The sender always sees the outcome — accepted by the target inbox, or retained as queued when delivery is temporarily unavailable. A queued message is already safely stored, so it must not be resent.

### Shared task board

Any member can add a task with a title, details, optional dependencies on other tasks, and optional hints about which files it will touch. A task is claimable only when everything it depends on is complete.

Tasks have an owner: a member claims a task to start work, completes it when done, releases it back, or reopens it; the Lead can assign a task to any member. Every change is compare-and-set: an update based on an outdated copy is rejected, so two members cannot silently overwrite each other's work.

File hints produce warnings when two in-progress tasks plan to touch overlapping paths — they never block anything. Deleted tasks remain in history but disappear from the active list.

### Waiting and interruption

A member can wait for the next team change — a teammate's status, an incoming message, or a task update — instead of polling repeatedly; the wait reports only whether it timed out, and the caller re-reads the current state afterward.

The Lead can stop a teammate's current turn without deleting its queued messages; task ownership is unchanged.

### What success and failure look like

Success looks like a teammate appearing in the roster, a message reporting `accepted` or `queued`, and task revisions advancing with each change. Likely failures are reported as specific errors instead of silently corrupting state: sending to a name that is not a member, claiming a task that is not ready, editing with an outdated revision, or creating a teammate beyond the member limit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the service and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The service is built on one separation and three commitments:

- **Durable log, derived state.** The Lead Session log is the single source of truth; roster, mailbox, and task state are replayed from it on every read.
- **Process-local ownership.** All coordination lives in one process; the guarantee is retry plus de-duplication, never cross-process consensus.
- **Explicit authority.** Every service method takes the exact live calling `Agent`; only the Lead spawns, reassigns, or interrupts.
- **Bounds that fail loud.** Every limit is a validated deployment value, and exhaustion reports a typed error instead of reusing an id or name.

The [Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns the identity, mailbox, task, and shared-checkout decisions.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, service registration, recovery scheduling |
| [`src/roster.ts`](src/roster.ts) | Team identity, membership resolution, provisioning, and roster teardown |
| [`src/mailbox.ts`](src/mailbox.ts) | Durable queue, target-local dispatch, acknowledgement, and recovery |
| [`src/task-board.ts`](src/task-board.ts) | Task CAS commands, DAG validation, and derived views |
| [`src/profile.ts`](src/profile.ts) | Declared agent profiles: the reusable identities a Team may instantiate |
| [`src/range.ts`](src/range.ts) | The three independent ceilings a member's effort, backend, and preset must fall inside |
| [`src/journal.ts`](src/journal.ts) | Serialized Lead-log transactions and commit notification |
| [`src/projection.ts`](src/projection.ts) | Strict replay projection that decodes and validates Team events and publishes the `agentTeam` client view |
| [`src/task-view.ts`](src/task-view.ts) | Pure task readiness, owner-name, and write-overlap derivation shared by the task board and the client view |
| [`src/activity.ts`](src/activity.ts) | One-shot change waiters and disposal release |
| [`src/lifecycle.ts`](src/lifecycle.ts) | Shared admission cutoff and bounded settlement |

### Team identity and roster

Every ordinary runtime root is the implicit Lead of a Team whose `TeamId` equals its `SessionId`; there is no creation event, and durable state begins with the first member, message, or task record. `spawnTeammate()` checks the requested execution backend against the backends this deployment has registered and refuses one that is absent with `TEAM_BACKEND_NOT_AVAILABLE` before it writes anything down; otherwise it appends and flushes a `provisioning` member record, then asks the configured provider to create the reserved child, and a provider failure appends a durable `failed` member — which still holds its name and still counts against `maxMembers`. A fresh child starts with no Lead history; a fork child captures the Lead's completed-turn prefix once. Recovery reconciles an unterminated provisioning record against the child's independently persisted Session: a matching direct-parent and continuable descriptor plus a recorded initial user message produces `active`, and anything else produces `failed`. If recovery wins a same-process race, the creator accepts the terminal state or reports `TEAM_PROVISIONING_CONFLICT` and drains the child. Names are reserved by the first provisioning record and never reused.

### Durable mailbox

`sendMessage()` validates peer membership, appends `team/message/queued`, and flushes before attempting delivery. The target message begins with `Team message <id> from <name>:` and keeps the same id and sender in `TeamMessageSource`. A target receipt is acknowledged with `team/message/delivered` only after the target Session durably holds the message identity in its pending inbox or recorded history. Immediate admissions are serialized per target in durable queue order; recovery dispatches queued-minus-delivered records in the same order. Delivery folds both live and persisted target inbox/history state before retrying, so a crash between inbox acceptance and model claim does not duplicate the message. The guarantee is process-local retry plus target-Session de-duplication, not cross-process exactly-once delivery.

Lead delivery calls `Agent.steer()` directly. Teammate delivery uses the continuation owner's host-only Steer path, which preserves the Team sender source while authorizing the Lead-to-child edge and cold-resuming inactive targets. Sibling messages never impersonate the Lead through the public adjacent-Agent messaging operation.

### Shared task board

Tasks are complete versioned snapshots; every mutation carries `expectedRevision`, and a stale caller receives `TEAM_TASK_STALE_REVISION` instead of overwriting a newer value. Numeric `task-<n>` ids require a safe-integer suffix, and id-space exhaustion reports `TEAM_TASK_LIMIT` instead of reusing the final id. Deleted tasks remain tombstones for replay and id stability but do not consume `maxTasks` or appear in `listTasks()`. `writeScopes` are normalized workspace-relative prefixes; views warn on overlap with in-progress tasks but never block claim or authorize writes.

### Waiting and interruption

`waitForChange()` waits for one roster, task, mailbox, or live-status edge that occurs after registration, from ten seconds through one hour, and reports only whether it timed out; runtime disposal releases current waits. Cancellation preserves an Error reason or reports a non-Error reason through `TEAM_WAIT_ABORTED`. `interrupt()` is Lead-only and delegates to the continuable-subagent interrupt path, which cancels only a live teammate's current turn with `keepInbox`; it neither releases task ownership nor deletes durable mail.

### Durability model

Team events are appended to the exact live Lead Session and flushed before the operation reports success or wakes waiters. `team/member`, `team/task`, `team/message/queued`, `team/message/delivered`, `team/message/broadcast`, and `team/message/broadcast-delivered` are log-only: they never enter the conversation surface, so derived model history is untouched by coordination records. Session event `seq` and `time` own ordering and timing; snapshots do not duplicate them.

Native V4 Team event and checkpoint admission reject retired `tool-result` content before it can enter mailbox state. Current writers keep `team/member` at payload version 2 and may include optional `modelProvider` and `reasoningEffort` fields. The Team projection also accepts version 3 member events written by an earlier merged build and normalizes them in memory without rewriting the log. This supports current readers of those histories; older builds are not guaranteed to read records containing the optional fields. Other historical Session-format conversion remains the responsibility of Session migrations.

Mailbox projection and checkpoint admission preserve every decoded JSON field of accepted content outside the locally declared validators, including an own `__proto__` key. Local field checks cover `text`, `reasoning`, `image`, and `tool-call`; accepted unknown tags remain opaque. Team projection cache version 4 rebuilds checkpoints from earlier cache versions from the Session log; the Session format version is unchanged.

### Disposal

Disposal closes admission, aborts and awaits admitted creation and mailbox-dispatch transactions, then asks the continuation owner to release the roster's exact live direct children and their descendants; non-Team continuable children of the Lead remain untouched. Cleanup failures make disposal fail visibly, bounded by `disposalTimeoutMs`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared subsystem types to the tool surface and the decisions behind the design.

- [Agent Teams subsystem](../../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [tool-agent-team package](../tool-agent-team/README.md) — the tools that let the model create, message, and coordinate teammates.
- [Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) — identity, mailbox, task, and shared-checkout decisions.
- [Experimental package reference](../AGENTS.md) — placement, publication, and dependency isolation.

-----

<a id="model-experience"></a>

### Browser projection

The `agentTeam` Session projection publishes the Lead Session's durable roster identities and phases, member errors, non-deleted task views, and any `failure` beside the last valid state. Its `apply` replaces only the touched collection; mailbox-only changes retain the client view reference and produce no frame. The [subsystem reference](../../../docs/subsystems/agent-team.md#web-projection) defines the wire types.

The [Web UI](../client-ui-agent-team/README.md) reads the shared Session projections and overlays activity from Session status. Task creation and updates belong to Team agents through the service and model tools. The `./client` export supplies browser-safe roster, task, and projection types.

## Model Experience

### Peer messages

#### What the model sees

Each delivered peer message is a user-role message. A short first text block names its stable message id and sender; the sender's original content blocks follow unchanged. Roster, task, and mailbox records are log-only and never enter derived model history.

#### Token effect

Each peer delivery adds the sender prefix plus message content to the target history. Task and roster mutations add no model tokens; their model-facing representation belongs to `@deepseek-ai/dsh-experimental-tool-agent-team` results.

#### KV Cache effect

Peer messages append after the target's reusable history prefix. Cold resume reuses the persisted conversation before appending a previously undelivered item.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe what a team cannot do yet or what needs special operational care. They are current package constraints, not a comparison with other coordination mechanisms.

- **Whole-view broadcasts** — each roster or task change sends the complete roster and non-deleted task board, including descriptions, to every connected browser, even when it is viewing another Session.
- **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.
- **One process and one shared checkout** — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock.
- **Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff.
- **Flat immutable roster** — only the Lead creates direct teammates; there is no nested Team, rename, deletion, or name reuse.
- **No automatic ownership release** — inactivity, interruption, process exit, and failed work do not release a task owner.
- **Mailbox is not cross-process exactly-once** — concurrent harness processes over one Team are unsupported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Promotion

Promotion to a product-role group requires reviewing the public contract, limitations, test evidence, release payload, runtime dependents, and a named stable owner, per the [experimental subtree rules](../AGENTS.md).

#### Future directions

Undecided directions include nested Teams, automatic ownership release policies, cross-process mailbox transactions, and filesystem isolation via worktrees; none of these are committed.

</details>
