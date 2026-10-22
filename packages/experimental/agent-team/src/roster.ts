/** Team membership, continuable-child provisioning, and roster-owned teardown. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor, parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { ContinuableStart } from '@deepseek-ai/dsh-subagent'
import { errorMessage, TeamError } from './error.ts'
import type { TeamJournal } from './journal.ts'
import type { TeamRuntimeLifecycle } from './lifecycle.ts'
import { readPersistedSession } from './persisted.ts'
import { AgentProfileRegistry } from './profile.ts'
import type { TeamState } from './projection.ts'
import { checkRanges } from './range.ts'
import type { TeamRanges } from './range.ts'
import { messageAccepted } from './session-message.ts'
import { TeamId } from './types.ts'
import type {
  AgentProfile,
  ReleaseTeammateRequest,
  ResumeTeammateRequest,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeammateLifecycleResult,
  TeamAgentRoute,
  TeamMemberSnapshot,
  TeamMemberView,
  TeamModelSelection,
} from './types.ts'
import { MEMBER_NAME, requiredText } from './validation.ts'

type ResolvedTeamAgentRoute = Required<Pick<TeamAgentRoute, 'provider' | 'model'>>
  & Pick<TeamAgentRoute, 'reasoningEffort'>

/** No Team-specific ceiling of any kind. */
const EMPTY_RANGES: TeamRanges = { allowedEfforts: [], allowedBackends: [], allowedPresets: [] }

/** Caller identity inside one implicit Team. */
export interface TeamMembership {
  readonly root: Agent
  readonly id: TeamId
  readonly role: 'lead' | 'teammate'
  readonly name: string
}

interface TeamModelPolicy {
  readonly allowedModels: readonly TeamModelSelection[]
  readonly defaultModel?: TeamModelSelection
}

interface HostModelPolicy {
  readonly enabled: boolean
  readonly allowedModels: readonly TeamModelSelection[]
}

/**
 * Resolve one active Team member by model-facing name, including the Lead pseudo-row.
 * @param root - exact live Team Lead.
 * @param state - current Team state.
 * @param rawName - candidate member name.
 * @returns resolved durable id and normalized name.
 */
export function resolveActiveMember(
  root: Agent,
  state: TeamState,
  rawName: string,
): { id: SessionId; name: string } {
  const name = rawName.trim()
  if (name === 'lead') return { id: root.id, name }
  const member = state.members.find(candidate => candidate.name === name)
  if (member === undefined || member.phase !== 'active') {
    throw new TeamError(`active teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
  }
  return { id: member.id, name }
}

/**
 * Resolve one reachable Team member by model-facing name, including the Lead pseudo-row.
 *
 * A reachable member is one that still exists as a durable identity: an
 * active member, or a dormant one whose runtime was released but whose
 * identity is kept for a later resume. A dormant member is a valid message
 * target — the message queues and arrives when the member comes back.
 * @param root - exact live Team Lead.
 * @param state - current Team state.
 * @param rawName - candidate member name.
 * @returns resolved durable id and normalized name.
 */
export function resolveReachableMember(
  root: Agent,
  state: TeamState,
  rawName: string,
): { id: SessionId; name: string } {
  const name = rawName.trim()
  if (name === 'lead') return { id: root.id, name }
  const member = state.members.find(candidate => candidate.name === name)
  if (member === undefined || (member.phase !== 'active' && member.phase !== 'dormant')) {
    throw new TeamError(`teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
  }
  return { id: member.id, name }
}

/** Owns Team identities and the lifecycle of rostered continuable children. */
export class TeamRoster {
  private readonly inFlightCreations = new Set<Promise<unknown>>()

  /**
   * @param ctx - Team service context with Agent, Session, persistence, and subagent services.
   * @param journal - authoritative Lead-log transaction owner.
   * @param lifecycle - shared Team runtime admission cutoff.
   * @param maxMembers - maximum immutable roster entries per Team.
   */
  constructor(
    private readonly ctx: Context,
    private readonly journal: TeamJournal,
    private readonly lifecycle: TeamRuntimeLifecycle,
    private readonly maxMembers: number,
    private readonly modelPolicy: () => TeamModelPolicy = () => ({ allowedModels: [] }),
    private readonly hostModelPolicy: () => HostModelPolicy | undefined = () => undefined,
    private readonly profileRegistry: () => AgentProfileRegistry = () => new AgentProfileRegistry(),
    private readonly ranges: () => TeamRanges = () => EMPTY_RANGES,
  ) {}

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    const membership = this.tryMembership(agent)
    if (membership === undefined) {
      throw new TeamError(`agent "${agent.id}" is not a member of an active Agent Team`, 'TEAM_NOT_MEMBER')
    }
    return membership
  }

  /**
   * Resolve a caller without throwing for scoped installation and lifecycle observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    if (this.ctx.agents.get(agent.id) !== agent) return undefined
    try {
      const parentId = agent.session.header.parentSession
      if (parentId !== undefined) {
        const root = this.ctx.agents.get(parentId)
        if (root !== undefined) {
          const member = this.journal.state(root).members.find(candidate => candidate.id === agent.id)
          if (member?.phase === 'active' || member?.phase === 'provisioning') {
            return { root, id: TeamId(root.id), role: 'teammate', name: member.name }
          }
          // A direct child outside the durable roster is not a teammate. Ordinary
          // host forks are independent roots; subagent descriptors distinguish
          // provider-owned workers that must not receive a nested Team identity.
          if (this.subagentDescriptor(agent)) return undefined
          return { root: agent, id: TeamId(agent.id), role: 'lead', name: 'lead' }
        }
      }
      // A continuation can briefly outlive its parent during child-first teardown.
      // Do not reinterpret that durable child as a new implicit root Team. A host-
      // resumed ordinary fork has no descriptor in its own suffix and remains a
      // valid new root whose inherited Team records stay outside its projected Team state.
      if (this.subagentDescriptor(agent)) return undefined
      return { root: agent, id: TeamId(agent.id), role: 'lead', name: 'lead' }
    } catch {
      // This method is used by lifecycle observers and teardown discovery. A
      // malformed durable stream is surfaced by authoritative Team operations;
      // the non-throwing probe must not veto unrelated Agent lifecycle edges.
      return undefined
    }
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param membership - exact caller membership resolved by this roster.
   * @returns Lead and teammate rows in creation order.
   */
  list(membership: TeamMembership): TeamMemberView[] {
    const { root } = membership
    const state = this.journal.state(root)
    const leadOptions = parentAgentOptionsForDelegation(root)
    const result: TeamMemberView[] = [{
      id: root.id,
      name: 'lead',
      role: 'lead',
      status: availability(root),
      ...leadOptions.model === undefined ? {} : { model: leadOptions.model },
      ...leadOptions.provider === undefined ? {} : { modelProvider: leadOptions.provider },
      ...leadOptions.reasoningEffort === undefined ? {} : { reasoningEffort: leadOptions.reasoningEffort },
      diagnostics: [],
    }]
    for (const member of state.members) {
      const live = this.ctx.agents.get(member.id)
      const model = live?.options.model ?? member.model ?? leadOptions.model
      const modelProvider = live?.options.provider ?? member.modelProvider ?? leadOptions.provider
      const reasoningEffort = live?.options.reasoningEffort ?? member.reasoningEffort
      result.push({
        id: member.id,
        name: member.name,
        role: 'teammate',
        status: member.phase === 'failed'
          ? 'failed'
          : member.phase === 'provisioning'
            ? 'provisioning'
            : member.phase === 'dormant'
              ? 'dormant'
              : availability(live),
        description: member.description,
        provider: member.provider,
        context: member.context,
        ...model === undefined ? {} : { model },
        ...modelProvider === undefined ? {} : { modelProvider },
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
        ...member.profileId === undefined ? {} : { profileId: member.profileId },
        ...member.preset === undefined ? {} : { preset: member.preset },
        // A dormant member keeps its durable identity and can be brought back
        // by a resume; the row says so instead of looking simply inactive.
        ...member.phase === 'dormant' ? { resumable: true } : {},
        diagnostics: member.error === undefined ? [] : [member.error],
      })
    }
    return result
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawn(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    const operation = this.spawnAdmitted(caller, request)
    this.inFlightCreations.add(operation)
    try {
      return await operation
    } finally {
      this.inFlightCreations.delete(operation)
    }
  }

  /**
   * Return admitted creation operations captured for ordered disposal.
   * @returns detached snapshot ordered only by Set insertion.
   */
  pendingCreations(): readonly Promise<unknown>[] {
    return [...this.inFlightCreations]
  }

  /**
   * Reconcile provisioning state when one Team member Session starts.
   * @param agent - newly started exact live Agent.
   * @param signal - shared runtime cancellation.
   */
  async recoverFor(agent: Agent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.tryMembership(agent)
    if (membership?.role === 'lead') await this.reconcileProvisioning(membership.root, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' } {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can interrupt teammates', 'TEAM_LEAD_REQUIRED')
    const state = this.journal.state(membership.root)
    const target = resolveActiveMember(membership.root, state, targetName)
    if (target.id === membership.root.id) throw new TeamError('the Team Lead cannot interrupt itself', 'TEAM_INVALID_TARGET')
    const live = this.ctx.agents.get(target.id)
    if (live === undefined) return { previousStatus: 'inactive' }
    const previousStatus = availability(live)
    this.ctx.subagents.interrupt(target.id, { kind: 'ancestor', agent: caller })
    return { previousStatus }
  }

  /**
   * Release one resident teammate into its dormant state.
   *
   * The durable member row stays, so the same identity — and the same profile
   * behind it — can be brought back later instead of being spawned again.
   * @param caller - exact live Lead Agent.
   * @param request - teammate name and cancellation.
   * @returns the dormant member row.
   */
  async release(caller: Agent, request: ReleaseTeammateRequest): Promise<TeammateLifecycleResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can release teammates', 'TEAM_LEAD_REQUIRED')
    }
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal])
    signal.throwIfAborted()
    const root = membership.root
    const member = this.namedMember(root, request.name)
    if (member.phase !== 'active') {
      throw new TeamError(`teammate "${request.name}" is not an active member`, 'TEAM_MEMBER_NOT_FOUND')
    }
    await this.stopTeammates(root, [member.id])
    const dormant = await this.journal.transact(root.id, async () => {
      signal.throwIfAborted()
      const current = this.journal.state(root).members.find(candidate => candidate.id === member.id)
      if (current === undefined || current.phase !== 'active') {
        throw new TeamError(`teammate "${request.name}" is not an active member`, 'TEAM_MEMBER_NOT_FOUND')
      }
      const settled: TeamMemberSnapshot = { ...current, phase: 'dormant' }
      await this.journal.appendAndFlush(root, 'team/member', {
        version: 2,
        teamId: TeamId(root.id),
        member: settled,
      })
      return settled
    })
    return { member: this.memberView(dormant) }
  }

  /**
   * Bring one dormant teammate back and give it its next task.
   *
   * The durable child Session is cold-resumed from persistence, so the member
   * keeps its identity and its history; only its runtime was released.
   * @param caller - exact live Lead Agent.
   * @param request - teammate name, prompt, and cancellation.
   * @returns the active member row.
   */
  async resume(caller: Agent, request: ResumeTeammateRequest): Promise<TeammateLifecycleResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can resume teammates', 'TEAM_LEAD_REQUIRED')
    }
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal])
    signal.throwIfAborted()
    const root = membership.root
    const member = this.namedMember(root, request.name)
    if (member.phase !== 'dormant') {
      throw new TeamError(`teammate "${request.name}" is not a dormant member`, 'TEAM_MEMBER_NOT_FOUND')
    }
    // The member becomes active before its turn is submitted. The child
    // Agent is created while the prompt is on its way, and a member the
    // roster still calls dormant is not a Team member at that moment — so it
    // would come back without the tools that let it answer.
    const active = await this.journal.transact(root.id, async () => {
      signal.throwIfAborted()
      const current = this.journal.state(root).members.find(candidate => candidate.id === member.id)
      if (current === undefined || current.phase !== 'dormant') {
        throw new TeamError(`teammate "${request.name}" is not a dormant member`, 'TEAM_MEMBER_NOT_FOUND')
      }
      // The member runs again, so the failure of an earlier resume no longer
      // describes it: the stale reason is dropped instead of carried along.
      const { error: _staleFailure, ...withoutFailure } = current
      const settled: TeamMemberSnapshot = { ...withoutFailure, phase: 'active' }
      await this.journal.appendAndFlush(root, 'team/member', {
        version: 2,
        teamId: TeamId(root.id),
        member: settled,
      })
      return settled
    })
    // The subagent service cold-resumes an absent continuable child from
    // persistence and submits this turn to it.
    try {
      await this.ctx.subagents.sendMessage(caller, member.id, request.prompt, { signal })
    } catch (error: unknown) {
      // The member runs nothing, so it goes back to the phase it was
      // released into: an active member without a runtime is a member no
      // later resume can bring back. The reason travels with the row, so the
      // failure is still on record once this call is gone.
      await this.park(root, member.id, errorMessage(error))
      throw new TeamError(
        `teammate "${request.name}" cannot be resumed: ${errorMessage(error)}`,
        'TEAM_MEMBER_NOT_RESUMABLE',
        { cause: error },
      )
    }
    return { member: this.memberView(active) }
  }

  /**
   * Put one member back into the phase it was released into.
   *
   * A resume that fails leaves the member running nothing, and the phase
   * the roster carries has to say so: an active member without a runtime is
   * a member no later resume can bring back.
   * @param root - exact live Team Lead.
   * @param memberId - the member identity.
   * @param reason - why the member was parked, recorded on the member row.
   */
  private async park(root: Agent, memberId: SessionId, reason?: string): Promise<void> {
    try {
      await this.journal.transact(root.id, async () => {
        const current = this.journal.state(root).members.find(candidate => candidate.id === memberId)
        if (current === undefined || current.phase !== 'active') return
        const settled: TeamMemberSnapshot = {
          ...current,
          phase: 'dormant',
          ...reason === undefined ? {} : { error: reason },
        }
        await this.journal.appendAndFlush(root, 'team/member', {
          version: 2,
          teamId: TeamId(root.id),
          member: settled,
        })
      })
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `team member "${memberId}" could not be parked after a failed resume: ${errorMessage(error)}`,
      )
    }
  }

  /**
   * Group exact live roster children by their current Lead for runtime teardown.
   * @returns each live Lead and the roster child ids currently in the Agent registry.
   */
  liveChildrenByRoot(): Map<Agent, SessionId[]> {
    const teams = new Map<Agent, SessionId[]>()
    for (const agent of this.ctx.agents.list()) {
      const rootId = agent.session.header.parentSession
      if (rootId === undefined) continue
      const root = this.ctx.agents.get(rootId)
      if (root === undefined
        || !this.journal.state(root).members.some(member => member.id === agent.id)) continue
      const children = teams.get(root) ?? []
      children.push(agent.id)
      teams.set(root, children)
    }
    return teams
  }

  /**
   * Release exact teammate Activations through the continuation lifecycle owner.
   * @param root - exact live Team Lead authorizing release.
   * @param childIds - selected roster child ids.
   */
  async stopTeammates(root: Agent, childIds: readonly SessionId[]): Promise<void> {
    await this.lifecycle.withTimeout(this.ctx.subagents.drainContinuableChildren(root, childIds))
  }

  /** Perform one creation admitted before the Team runtime disposal cutoff. */
  private async spawnAdmitted(
    caller: Agent,
    request: SpawnTeammateRequest,
  ): Promise<SpawnTeammateResult> {
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can create teammates', 'TEAM_LEAD_REQUIRED')
    }
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal])
    signal.throwIfAborted()
    const root = membership.root
    const profile = request.profileId === undefined ? undefined : this.profileRegistry().resolve(request.profileId)
    if (profile !== undefined) {
      if (request.name !== undefined && request.name !== profile.name) {
        throw new TeamError(
          `teammate name conflicts with the declared profile "${profile.id}"`,
          'TEAM_PROFILE_CONFLICT',
        )
      }
      if (request.provider !== undefined && profile.backend !== undefined && request.provider !== profile.backend) {
        throw new TeamError(
          `execution backend conflicts with the declared profile "${profile.id}"`,
          'TEAM_PROFILE_CONFLICT',
        )
      }
      if (request.preset !== undefined && profile.preset !== undefined && request.preset !== profile.preset) {
        throw new TeamError(
          `preset conflicts with the declared profile "${profile.id}"`,
          'TEAM_PROFILE_CONFLICT',
        )
      }
    }
    const name = this.memberName(profile?.name ?? request.name ?? '')
    const description = requiredText(profile?.description ?? request.description ?? '', 'description', 200)
    const backend = requiredText(profile?.backend ?? request.provider ?? '', 'provider', 200)
    // The preset is part of the member identity, so it follows the same rule
    // as the name and the backend: one profile id has to instantiate one
    // identity, and the declared profile wins over the request.
    const preset = profile?.preset ?? request.preset
    const teamPolicy = this.modelPolicy()
    const route = this.resolveModelRoute(root, request, teamPolicy, profile)
    if (profile?.allowedEfforts !== undefined && profile.allowedEfforts.length > 0
      && route?.reasoningEffort !== undefined && !profile.allowedEfforts.includes(route.reasoningEffort)) {
      throw new TeamError(
        `reasoning effort "${route.reasoningEffort}" is outside the profile "${profile.id}" allowed-effort range`,
        'TEAM_EFFORT_NOT_ALLOWED',
      )
    }
    checkRanges(this.ranges(), {
      ...route?.reasoningEffort === undefined ? {} : { effort: route.reasoningEffort },
      backend,
      ...preset === undefined ? {} : { preset },
    })
    // The range says which backends this Team allows; the registry says
    // which backends this deployment has. A backend that is allowed but
    // absent would fail later, after the member row was written — and a
    // failed member still holds its name and its slot.
    if (!this.ctx.subagents.list().includes(backend)) {
      throw new TeamError(
        `execution backend "${backend}" is not a registered subagent backend`,
        'TEAM_BACKEND_NOT_AVAILABLE',
      )
    }
    if (teamPolicy.allowedModels.length > 0) {
      if (route === undefined) throw new TeamError('a provider/model route from the Team allowed-model list is required', 'TEAM_MODEL_REQUIRED')
      if (!teamPolicy.allowedModels.some(candidate => candidate.provider === route.provider && candidate.model === route.model)) {
        throw new TeamError(`model "${route.provider}/${route.model}" is not allowed for this Team`, 'TEAM_MODEL_NOT_ALLOWED')
      }
    }
    const hostPolicy = this.hostModelPolicy()
    const requestedModelSelection = request.model !== undefined
      || request.agentOptions?.provider !== undefined
      || request.agentOptions?.model !== undefined
      || request.agentOptions?.reasoningEffort !== undefined
      || teamPolicy.defaultModel !== undefined
      || teamPolicy.allowedModels.length > 0
    if (requestedModelSelection) {
      if (hostPolicy === undefined) {
        throw new TeamError('model selection requires the Host-owned model-selection policy service', 'TEAM_HOST_MODEL_SELECTION_UNAVAILABLE')
      }
      if (!hostPolicy.enabled) {
        throw new TeamError('model selection is disabled by the Host', 'TEAM_HOST_MODEL_SELECTION_DISABLED')
      }
      if (route === undefined || !hostPolicy.allowedModels.some(candidate => candidate.provider === route.provider && candidate.model === route.model)) {
        throw new TeamError('the selected model route is outside the Host-authorized list', 'TEAM_HOST_MODEL_NOT_ALLOWED')
      }
    }
    if (route?.reasoningEffort !== undefined) {
      const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
      if (!info.reasoning?.efforts.some(effort => effort.id === route.reasoningEffort)) {
        throw new TeamError(
          `reasoning effort "${route.reasoningEffort}" is not advertised for "${route.provider}/${route.model}"`,
          'TEAM_REASONING_EFFORT_NOT_ALLOWED',
        )
      }
    }
    const childId = brandString<SessionId>(randomUUID())
    const member: TeamMemberSnapshot = {
      id: childId,
      name,
      description,
      provider: backend,
      ...route === undefined ? {} : {
        model: route.model,
        modelProvider: route.provider,
        ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
      },
      ...profile === undefined ? {} : { profileId: profile.id },
      ...preset === undefined ? {} : { preset },
      context: request.context,
      phase: 'provisioning',
    }

    await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      // A member name stays reserved inside its Team, failed instances
      // included: the name is the profile's identity, and one Team may hold
      // one instance of it. Reusing a profile in another Team is how the same
      // identity gets instantiated again.
      if (state.members.some(member => member.name === name)) {
        throw new TeamError(`teammate name "${name}" was already used in this Team`, 'TEAM_MEMBER_NAME_TAKEN')
      }
      if (state.members.length >= this.maxMembers) {
        throw new TeamError(`Team member limit ${this.maxMembers} reached`, 'TEAM_MEMBER_LIMIT')
      }
      await this.journal.appendAndFlush(root, 'team/member', { version: 2, teamId: TeamId(root.id), member })
    })

    let started: ContinuableStart
    try {
      started = await this.ctx.subagents.startContinuable({
        childId,
        provider: backend,
        label: description,
        request: {
          prompt: request.prompt,
          parent: root,
          ...route === undefined ? {} : { agentOptions: {
            provider: route.provider,
            model: route.model,
            ...route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) },
          } },
        },
        signal,
      })
      await this.checkpointInitialPrompt(childId, started.messageId, signal)
    } catch (error: unknown) {
      const failed: TeamMemberSnapshot = {
        ...member,
        phase: 'failed',
        error: errorMessage(error),
      }
      try {
        const phase = await this.settleProvisioning(root, failed)
        await this.stopTeammates(root, [childId])
        if (phase === 'active') {
          throw new TeamError(
            `teammate "${name}" became active while its creator reported failure`,
            'TEAM_PROVISIONING_CONFLICT',
            { cause: error },
          )
        }
      } catch (recordError: unknown) {
        throw new AggregateError([error, recordError], 'teammate creation and durable failure recording both failed')
      }
      throw error
    }
    const active = {
      ...member,
      phase: 'active' as const,
    } satisfies TeamMemberSnapshot
    // Once the continuation accepted its first prompt, it is a real child. If
    // this checkpoint fails, keep the in-memory active edge instead of inventing
    // an impossible active -> failed transition; restart reconciliation covers
    // the provisioning-only durable prefix.
    const settledPhase = await this.settleProvisioning(root, active)
    if (settledPhase === 'failed') {
      const conflict = new TeamError(
        `teammate "${name}" was reconciled as failed while creation was in progress`,
        'TEAM_PROVISIONING_CONFLICT',
      )
      try {
        await this.stopTeammates(root, [childId])
      } catch (cleanupError: unknown) {
        /* v8 ignore next -- requires the independently tested HMR settlement conflict and cleanup failure together. */
        throw new AggregateError([conflict, cleanupError], 'provisioning conflict cleanup failed')
      }
      throw conflict
    }
    return { member: this.memberView(active) }
  }

  /** Resolve the child LLM route without confusing it with the subagent backend. */
  private resolveModelRoute(
    root: Agent,
    request: SpawnTeammateRequest,
    teamPolicy: TeamModelPolicy,
    profile?: AgentProfile,
  ): ResolvedTeamAgentRoute | undefined {
    const leadOptions = parentAgentOptionsForDelegation(root)
    // A declared profile pins the route; a request may only narrow it with the
    // same provider and model.
    if (profile?.provider !== undefined && profile.model !== undefined) {
      const requestedProvider = request.agentOptions?.provider?.trim()
      const requestedModel = request.agentOptions?.model?.trim()
      if ((requestedProvider !== undefined && requestedProvider !== profile.provider)
        || (requestedModel !== undefined && requestedModel !== profile.model)) {
        throw new TeamError(
          `model route conflicts with the declared profile "${profile.id}"`,
          'TEAM_PROFILE_CONFLICT',
        )
      }
      const effort = request.agentOptions?.reasoningEffort?.trim()
      return {
        provider: profile.provider,
        model: profile.model,
        ...effort === undefined || effort.length === 0 ? {} : { reasoningEffort: effort },
      }
    }
    if (request.agentOptions !== undefined) {
      const requestedProvider = request.agentOptions.provider?.trim()
      const requestedModel = request.agentOptions.model?.trim()
      const effort = request.agentOptions.reasoningEffort?.trim()
      if ((requestedProvider === undefined) !== (requestedModel === undefined)
          || requestedProvider === '' || requestedModel === '' || effort === '') {
        throw new TeamError('Team model selection requires provider and model together', 'TEAM_MODEL_INVALID')
      }
      const provider = requestedProvider ?? (effort === undefined ? undefined : leadOptions.provider?.trim())
      const model = requestedModel ?? (effort === undefined ? undefined : leadOptions.model?.trim())
      if (provider === undefined || model === undefined || provider.length === 0 || model.length === 0) {
        throw new TeamError('Team reasoning selection requires an effective provider and model', 'TEAM_MODEL_INVALID')
      }
      return { provider, model, ...effort === undefined ? {} : { reasoningEffort: effort } }
    }

    const requestedModel = request.model?.trim()
    if (requestedModel !== undefined && requestedModel.length > 0) {
      const provider = leadOptions.provider?.trim()
      if (provider !== undefined && provider.length > 0) return { provider, model: requestedModel }
      throw new TeamError('the legacy model field requires the Lead LLM provider', 'TEAM_MODEL_INVALID')
    }

    if (teamPolicy.defaultModel !== undefined) return teamPolicy.defaultModel
    if (teamPolicy.allowedModels.length === 0) return undefined
    const provider = leadOptions.provider?.trim()
    const model = leadOptions.model?.trim()
    return provider !== undefined && provider.length > 0 && model !== undefined && model.length > 0
      ? { provider, model }
      : undefined
  }

  /** Flush the accepted initial inbox item before the Lead can commit `active`. */
  private async checkpointInitialPrompt(
    childId: SessionId,
    messageId: MessageId,
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      signal.throwIfAborted()
      const session = this.ctx.sessions.get(childId)
      if (session === undefined) {
        const stored = await readPersistedSession(this.ctx.sessionPersistence, childId, signal)
        const suffix = stored.events.slice(stored.inheritedEventCount)
        if (messageAccepted(suffix, message => message.id === messageId)) return
        throw new TeamError(
          `teammate "${childId}" initial prompt was not durably accepted`,
          'TEAM_PROVISIONING_CONFLICT',
        )
      }

      const progress = Promise.withResolvers<void>()
      // Abort can win while the durability flush is still pending; mark the
      // later-awaited rejection handled without changing its eventual result.
      void progress.promise.catch(() => undefined)
      const stopEvent = this.ctx.on('session/event', (candidate) => {
        if (candidate === session) progress.resolve()
      })
      const stopDisposed = this.ctx.on('session/disposed', (candidate) => {
        if (candidate === session) progress.resolve()
      })
      const onAbort = (): void => {
        const reason: unknown = signal.reason
        progress.reject(reason instanceof Error
          ? reason
          : new TeamError(`teammate creation aborted: ${errorMessage(reason)}`, 'TEAM_DISPOSED'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        await this.ctx.sessions.flush(session)
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        const suffix = session.snapshotEvents(session.inheritedEventCount)
        if (messageAccepted(suffix, message => message.id === messageId)) return
        if (this.ctx.sessions.get(childId) !== session) continue
        await progress.promise
      } finally {
        signal.removeEventListener('abort', onAbort)
        stopDisposed()
        stopEvent()
      }
    }
  }

  /** Settle provisioning-only members from their independently durable child Sessions. */
  private async reconcileProvisioning(root: Agent, signal: AbortSignal): Promise<void> {
    const provisioning = this.journal.state(root).members.filter(member => member.phase === 'provisioning')
    for (const member of provisioning) {
      signal.throwIfAborted()
      // A live child means creation is still completing in this process. Its
      // creator owns the terminal member edge.
      if (this.ctx.agents.get(member.id) !== undefined) continue
      let phase: 'active' | 'failed' = 'failed'
      let failure = 'provisioning did not leave a resumable child Session'
      try {
        const loaded = await readPersistedSession(this.ctx.sessionPersistence, member.id, signal)
        const suffix = loaded.events.slice(loaded.inheritedEventCount)
        const descriptor = foldSubagentDescriptor(suffix)
        const acceptedInitialPrompt = messageAccepted(suffix, message => message.source.kind === 'user')
        if (loaded.header.parentSession === root.id
          && descriptor?.mode === 'continuable'
          && descriptor.provider === member.provider
          && acceptedInitialPrompt) {
          phase = 'active'
        } else {
          failure = 'persisted child Session does not match the provisioned continuation'
        }
      } catch (error: unknown) {
        failure = `child Session recovery failed: ${errorMessage(error)}`
      }
      signal.throwIfAborted()
      await this.journal.transact(root.id, async () => {
        signal.throwIfAborted()
        const current = this.journal.state(root).members.find(candidate => candidate.id === member.id)
        if (current?.phase !== 'provisioning') return
        const settled: TeamMemberSnapshot = {
          ...current,
          phase,
          ...phase === 'failed' ? { error: failure } : {},
        }
        await this.journal.appendAndFlush(root, 'team/member', {
          version: 2,
          teamId: TeamId(root.id),
          member: settled,
        })
      })
    }
  }

  /** Build one runtime member row after successful creation. */
  private memberView(member: TeamMemberSnapshot): TeamMemberView {
    const live = this.ctx.agents.get(member.id)
    const model = live?.options.model ?? member.model
    const modelProvider = live?.options.provider ?? member.modelProvider
    const reasoningEffort = live?.options.reasoningEffort ?? member.reasoningEffort
    return {
      id: member.id,
      name: member.name,
      role: 'teammate',
      status: member.phase === 'dormant' ? 'dormant' : availability(live),
      description: member.description,
      provider: member.provider,
      context: member.context,
      ...model === undefined ? {} : { model },
      ...modelProvider === undefined ? {} : { modelProvider },
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      ...member.profileId === undefined ? {} : { profileId: member.profileId },
      ...member.preset === undefined ? {} : { preset: member.preset },
      ...member.phase === 'dormant' ? { resumable: true } : {},
      diagnostics: [],
    }
  }

  /** Validate a never-reused model-facing teammate name. */
  private memberName(value: string): string {
    if (!MEMBER_NAME.test(value) || value.length > 64 || value === 'lead') {
      throw new TeamError(
        'teammate name must be lower-kebab-case, at most 64 characters, and not "lead"',
        'TEAM_INVALID_MEMBER_NAME',
      )
    }
    return value
  }

  /**
   * Resolve one durable member row by its model-facing name.
   * @param root - exact live Team Lead.
   * @param rawName - candidate member name.
   * @returns the durable member row.
   */
  private namedMember(root: Agent, rawName: string): TeamMemberSnapshot {
    const name = rawName.trim()
    const member = this.journal.state(root).members.find(candidate => candidate.name === name)
    if (member === undefined) {
      throw new TeamError(`teammate "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
    }
    return member
  }

  /** Append one terminal provisioning edge unless recovery already settled it. */
  private async settleProvisioning(
    root: Agent,
    terminal: TeamMemberSnapshot,
  ): Promise<'active' | 'failed'> {
    return this.journal.transact(root.id, async () => {
      const current = this.journal.state(root).members.find(member => member.id === terminal.id)
      /* v8 ignore next 3 -- the append-only provisioning event is committed by this operation before settlement. */
      if (current === undefined) {
        throw new TeamError(`provisioned teammate "${terminal.id}" disappeared`, 'TEAM_PROVISIONING_CONFLICT')
      }
      if (current.phase !== 'provisioning') return current.phase === 'active' ? 'active' : 'failed'
      await this.journal.appendAndFlush(root, 'team/member', {
        version: 2,
        teamId: TeamId(root.id),
        member: terminal,
      })
      return terminal.phase === 'active' ? 'active' : 'failed'
    })
  }

  /** Whether a Session's own suffix identifies a provider-owned subagent child. */
  private subagentDescriptor(agent: Agent): boolean {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    return foldSubagentDescriptor(agent.session.snapshotEvents(agent.session.inheritedEventCount)) !== undefined
  }
}

/** Turn availability is independent of whether the Agent is loaded. */
function availability(agent: Agent | undefined): 'running' | 'inactive' {
  return agent?.status === 'running' ? 'running' : 'inactive'
}
