/** Public Agent Teams identities, durable records, and service request values. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Volatile } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Optional model route selected for a spawned teammate. */
export interface TeamAgentRoute {
  readonly provider?: string
  readonly model?: string
  /** Exact model-advertised effort id; omission delegates to the model default. */
  readonly reasoningEffort?: string
}

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/**
 * Brand one root Session identity as its implicit Team identity.
 * @param id - Root Session identity.
 * @returns the same string branded as a Team identity.
 */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/**
 * Brand a validated task id.
 * @param id - Team-local task identity.
 * @returns the same string branded as a Team task identity.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/**
 * Brand a generated peer-message id.
 * @param id - Durable mailbox message identity.
 * @returns the same string branded as a Team message identity.
 */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'dormant' | 'failed'

/** Provider/model pair allowed for a Team member runtime. */
export interface TeamModelSelection {
  /** LLM provider name used by the child Agent. */
  readonly provider: string
  /** Model id interpreted by that provider. */
  readonly model: string
}

/**
 * One declared agent profile: the reusable identity of a teammate.
 *
 * A profile is a deployment fact, not a session fact. It names the member,
 * says what it does, and pins the route and the ranges it may run under, so
 * the same identity can be instantiated again in a later session instead of
 * living only in one Lead's log.
 */
export interface AgentProfile {
  /** Stable profile identity, addressable across sessions. */
  readonly id: string
  /** Member name a profile instance takes in its Team. */
  readonly name: string
  /** What the member is for. */
  readonly description: string
  /** Continuable subagent backend, such as `spawn` or `fork`. */
  readonly backend?: string
  /** LLM provider the member runs on. */
  readonly provider?: string
  /** Model id interpreted by that provider. */
  readonly model?: string
  /**
   * Exact model-advertised effort ids the profile may use.
   *
   * The declared list is mutable, like every other configured list in this
   * package: the array the deployment hands over is the array that is read,
   * and the service copies it before it stores or returns it. The readonly
   * list lives on the view, which is what a caller receives.
   */
  readonly allowedEfforts?: string[]
  /** Agent preset the member runs under. */
  readonly preset?: string
}

/** Model-facing view of one declared profile. */
export interface AgentProfileView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly backend?: string
  readonly provider?: string
  readonly model?: string
  readonly allowedEfforts?: readonly string[]
  readonly preset?: string
}

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
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

/** Version 2 member snapshot before optional model-route metadata was added. */
export type TeamMemberSnapshotV2 = Omit<TeamMemberSnapshot, 'modelProvider' | 'reasoningEffort'>

/** Current runtime-enriched roster row. */
export interface TeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'inactive' | 'provisioning' | 'dormant' | 'failed'
  readonly description?: string
  readonly provider?: string
  readonly context?: 'fresh' | 'fork'
  readonly model?: string
  readonly modelProvider?: string
  readonly reasoningEffort?: string
  /** Declared profile this member was instantiated from, when it came from one. */
  readonly profileId?: string
  /** Agent preset this member runs under, when the Team policy names one. */
  readonly preset?: string
  /** Whether this member can be brought back by a resume. */
  readonly resumable?: boolean
  readonly diagnostics: string[]
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
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

/** One durable roster row published through the `agentTeam` Session projection. */
export interface TeamMemberProjection {
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

/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; members and tasks then stay at the last valid state.
 */
export interface TeamProjection {
  readonly members: TeamMemberProjection[]
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Durable roster and non-deleted task board of the Team rooted at the projected Session. */
    agentTeam: TeamProjection
  }
}

/** One peer message retained until its target Session records it. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}

/** Source retained by the target Session for durable mailbox de-duplication. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/**
 * One durable broadcast: a single message addressed to several members.
 *
 * The broadcast is one durable record with many targets, so the content is
 * stored once; each target keeps its own delivery edge, exactly as a
 * single-target message does.
 */
export interface TeamBroadcastSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  /** Every target that must receive the broadcast. */
  readonly targetIds: readonly SessionId[]
  readonly content: ContentBlock[]
}

/** One target's delivery edge of a durable broadcast. */
export interface TeamBroadcastDelivery {
  readonly messageId: TeamMessageId
  readonly targetId: SessionId
}

/** Input for one durable broadcast. */
export interface BroadcastTeamMessageRequest {
  /** Target member names; every named member receives the message. */
  readonly targets: readonly string[]
  readonly content: ContentBlock[]
  readonly signal: AbortSignal
}

/** Result after a broadcast enters the durable mailbox. */
export interface BroadcastTeamMessageResult {
  readonly messageId: TeamMessageId
  readonly targetIds: readonly SessionId[]
  readonly status: 'accepted' | 'queued'
}

/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum queued-minus-delivered messages for one target member. */
  readonly maxPendingMessagesPerMember?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds allowed for Team-owned runtime disposal. */
  readonly disposalTimeoutMs?: number
  /** Additional independent provider/model ceiling for every Team. Empty means no Team-specific ceiling. */
  readonly allowedModels?: Volatile<TeamModelSelection[]> | TeamModelSelection[]
  /** Optional default route, which must also appear in the Team allowlist. */
  readonly defaultModel?: Volatile<TeamModelSelection | undefined> | TeamModelSelection
  /** Declared agent profiles, the reusable identities a Team may instantiate. */
  readonly profiles?: Volatile<AgentProfile[]> | AgentProfile[]
  /** Reasoning-effort ids a member may run under. Empty means no Team-specific ceiling. */
  readonly allowedEfforts?: Volatile<string[]> | string[]
  /** Execution backends a member may run under. Empty means no Team-specific ceiling. */
  readonly allowedBackends?: Volatile<string[]> | string[]
  /** Agent presets a member may run under. Empty means no Team-specific ceiling. */
  readonly allowedPresets?: Volatile<string[]> | string[]
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  /** Member name; a declared profile supplies it instead. */
  readonly name?: string
  /** What the member is for; a declared profile supplies it instead. */
  readonly description?: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  /** Continuable subagent backend, such as `spawn` or `fork`; a declared profile supplies it instead. */
  readonly provider?: string
  /** Legacy model id resolved with the Lead's LLM provider. */
  readonly model?: string
  /** Optional complete LLM route selected from the host-authorized model list. */
  readonly agentOptions?: TeamAgentRoute
  /** Declared profile to instantiate; the profile owns the name, description, and route. */
  readonly profileId?: string
  /** Agent preset the member runs under, when the Team policy names one. */
  readonly preset?: string
  readonly signal: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Input for releasing one resident teammate into its dormant state. */
export interface ReleaseTeammateRequest {
  /** Durable teammate name. */
  readonly name: string
  readonly signal: AbortSignal
}

/** Input for bringing one dormant teammate back. */
export interface ResumeTeammateRequest {
  /** Durable teammate name. */
  readonly name: string
  /** Prompt that gives the resumed member its next task. */
  readonly prompt: ContentBlock[]
  readonly signal: AbortSignal
}

/** Result after one teammate is released or brought back. */
export interface TeammateLifecycleResult {
  readonly member: TeamMemberView
}

/** Input for one durable peer message. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly signal: AbortSignal
}

/** Result after a peer message enters the durable mailbox. */
export interface SendTeamMessageResult {
  readonly messageId: TeamMessageId
  readonly status: 'accepted' | 'queued'
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value; optional model-route metadata is part of version 2. */
    'team/member': { version: 2; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 2; teamId: TeamId; task: TeamTaskSnapshot }
    /** Durable mailbox enqueue, stored before delivery is attempted. */
    'team/message/queued': { version: 2; teamId: TeamId; message: TeamMessageSnapshot }
    /** Durable acknowledgement that the target Session recorded the message. */
    'team/message/delivered': {
      version: 2
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
    /** Durable broadcast enqueue, stored before any target delivery is attempted. */
    'team/message/broadcast': { version: 1; teamId: TeamId; broadcast: TeamBroadcastSnapshot }
    /** Durable acknowledgement that one target Session recorded the broadcast. */
    'team/message/broadcast-delivered': {
      version: 1
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
  }
}
