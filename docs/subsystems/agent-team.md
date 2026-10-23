# Agent Teams

English | [中文](agent-team.zh.md)

Types shared by the experimental implicit-root Team domain, model tools, and host adapters. The [Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns identity, mailbox, task, and shared-checkout decisions; this page records the durable and client-visible forms from [`packages/experimental/agent-team/src/types.ts`](../../packages/experimental/agent-team/src/types.ts) and the range ceilings from [`packages/experimental/agent-team/src/range.ts`](../../packages/experimental/agent-team/src/range.ts).

## Identity and roster

`TeamId` is the root `SessionId` under a distinct [brand](core.md#branded-ids). `TeamTaskId` is Team-local and monotonically allocated as `task-<n>`; `TeamMessageId` is globally random. A teammate's Session id remains its persistent identity, while `name` is an immutable model/UI label.

```ts type-equiv
/** Provider/model pair allowed for a Team member runtime. */
interface TeamModelSelection {
  /** LLM provider name used by the child Agent. */
  readonly provider: string
  /** Model id interpreted by that provider. */
  readonly model: string
}
```

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  /** Model selected for this member, when the Team policy specifies one. */
  readonly model?: string
  /** LLM provider selected for this member; `provider` above remains the spawn/fork backend. */
  readonly modelProvider?: string
  /** Exact model-advertised reasoning effort selected for this member. */
  readonly reasoningEffort?: string
  /** Declared profile this member was instantiated from, when it came from one. */
  readonly profileId?: string
  /** Agent preset this member runs under, when the Team policy names one. */
  readonly preset?: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}
```

Every member starts in `provisioning` and reaches exactly one terminal roster phase, `active` or `failed`. Roster `running`/`inactive` status is derived separately and never rewrites this record.

`team/member` continues to write payload v2 with optional `modelProvider` and `reasoningEffort` fields; existing v2 records without them remain readable. The projection reader also accepts records from the intermediate v3 writer and normalizes them to v2 in memory without rewriting Session logs. Other Agent Teams event payloads remain v2. The `agentTeam` projection cache is at state version 5, so a v4 cache is rebuilt from the Session log.

## Profiles and range ceilings

`AgentProfileView` is the model-facing view of one declared profile: the reusable identity of a teammate, together with the route it may run under. A profile is a deployment fact rather than a session fact, so the same identity can be instantiated again in a later session instead of living only in one Lead's log. `ctx.agentTeams.profiles()` lists the declared profiles in declaration order.

`TeamRanges` holds the Team's three independent ceilings on its members: `allowedEfforts`, `allowedBackends`, and `allowedPresets`. Every list is a set of exact names rather than an interval, and an empty list means the Team places no ceiling of that kind. The ranges bound every member of the Team, while a profile narrows one member further.

## Teammate residency and reuse

A teammate is spawned, released into its dormant state, and later resumed. `ReleaseTeammateRequest` names the durable teammate and carries the caller's cancellation. `ResumeTeammateRequest` names the same teammate, adds the prompt that gives the resumed member its next task, and carries its own cancellation. The durable member row stays in place across both transitions, so the same identity returns through a resume instead of a new spawn.

`TeammateLifecycleResult` is the outcome of either transition: it carries the roster row the member now holds, so a caller reads the same `TeamMemberView` shape whether the member became dormant or became active again.

## Durable mailbox

The Lead Session first stores the complete queued message. A target receipt is acknowledged only after its pending inbox item or recorded user message is durable, leaving queued-minus-delivered as the recovery mailbox.

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}
```

Every message attempts Steer delivery. A running target receives it at the nearest step boundary; an inactive target starts a turn if loaded or cold-resumes otherwise. Scheduling is not stored in the durable record because callers cannot select another mode.

The target Session keeps message identity and sender attribution on both the pending inbox item and the eventual user message. Folding that source across inbox and history is the target-side de-duplication key; the model-visible framing repeats the id and sender.

A broadcast addresses several members with one durable record. `BroadcastTeamMessageRequest` names the target members and carries the content and the caller's cancellation; every named member receives the message. `BroadcastTeamMessageResult` carries the durable message identity, the resolved target Session ids, and whether the broadcast was `accepted` or is still `queued`. Each target keeps its own delivery edge, so an unreachable member holds back only its own copy and never the targets queued behind it.

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## Shared task DAG

Every task event stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views add owner name, readiness, and write-scope overlap warnings without changing the durable snapshot.

<a id="web-projection"></a>

## Web projection

The Lead Session publishes `SessionProjectionMap.agentTeam` with durable roster rows and non-deleted task views. `failure` reports a rejected persisted record beside the last valid state. Member activity comes from Session status; model labels come from each member's `modelSelection` projection.

```ts type-equiv
/** One durable roster row published through the `agentTeam` Session projection. */
interface TeamMemberProjection {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  /** Durable lifecycle; the Lead row is always `active`. Turn activity comes from Session status. */
  readonly phase: TeamMemberPhase
  /** Effective member route recorded when the teammate was created. */
  readonly model?: string
  readonly modelProvider?: string
  readonly reasoningEffort?: string
  /** Declared profile this member was instantiated from, when it came from one. */
  readonly profileId?: string
  /** Agent preset this member runs under, when the Team policy names one. */
  readonly preset?: string
  readonly error?: string
}
```

```ts type-equiv
/** Runtime-enriched task view returned to tools and hosts. */
interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}
```

```ts type-equiv
/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; members and tasks then stay at the last valid state.
 */
interface TeamProjection {
  readonly members: TeamMemberProjection[]
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}
```

## Replay

The `agentTeam` Session projection replays one root Session into the roster, task board, and queued-minus-delivered mailbox that every Team operation reads. It selects records by `TeamId`, so events inherited by an ordinary fork retain the ancestor id and never enter the new root's state. Session event `seq` and `time` remain the ordering and timing record; Team snapshots do not duplicate them. Roster and task reads reach callers as views; pending mail stays internal to delivery and recovery. The package [README](../../packages/experimental/agent-team/README.md) owns operation, authorization, recovery, and limit behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Read the live Team-specific provider/model ceiling for settings and admission.
 * @returns the current Team allowlist and optional default route.
 * @throws {TeamError} if Team routes are invalid or the default is not in allowedModels.
 */
modelPolicy(): { allowedModels: TeamModelSelection[]; defaultModel?: TeamModelSelection }

/**
 * List the deployment's declared agent profiles.
 *
 * A profile is the reusable identity of a teammate: it names the member,
 * says what it is for, and pins the route and ranges it may run under.
 * @returns the declared profiles in declaration order.
 */
profiles(): AgentProfileView[]

/**
 * Read the Team's three range ceilings.
 *
 * Each list is a set of exact names; an empty list means the Team places no
 * ceiling of that kind.
 * @returns the Team's effort, backend, and preset ceilings.
 */
ranges(): TeamRanges

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Release one resident teammate into its dormant state.
 *
 * The durable member row stays, so the same identity can be brought back by
 * a later resume instead of being spawned again.
 * @param caller - exact live Lead Agent.
 * @param request - teammate name and cancellation.
 * @returns the dormant roster row.
 */
async releaseTeammate(caller: Agent, request: ReleaseTeammateRequest): Promise<TeammateLifecycleResult>

/**
 * Bring one dormant teammate back and give it its next task.
 * @param caller - exact live Lead Agent.
 * @param request - teammate name, prompt, and cancellation.
 * @returns the active roster row.
 */
async resumeTeammate(caller: Agent, request: ResumeTeammateRequest): Promise<TeammateLifecycleResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Queue one durable broadcast, then attempt immediate delivery.
 *
 * One durable record addresses several members at once; every target keeps
 * its own delivery edge and its own pending-message ceiling.
 * @param caller - exact live sending Team member.
 * @param request - target names, content, and pre-queue cancellation.
 * @returns durable broadcast identity, its targets, and the delivery observation.
 */
async broadcastMessage( caller: Agent, request: BroadcastTeamMessageRequest, ): Promise<BroadcastTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined
```

Types: [Agent](core.md)

Source: [`packages/experimental/agent-team/src/index.ts`](../../packages/experimental/agent-team/src/index.ts)

<a id="ctxterminalteamstatus--terminalteamstatus"></a>

### `ctx.terminalTeamStatus` — `TerminalTeamStatus`

Read-only terminal team presentation supplied by an optional collaboration plugin.

```ts cordis-catalog
/**
 * Describe the roster and tasks visible to the exact live Agent without changing team state.
 * @param agent - live Agent whose team authority determines visible rows.
 * @returns terminal display rows; no credentials or mutable team records.
 */
describe(agent: Agent): readonly string[]
```

Types: [Agent](core.md)

Source: [`packages/bundle/headless/src/index.ts`](../../packages/bundle/headless/src/index.ts)
<!-- END GENERATED cordis-surface -->
