/** Agent Teams service façade over roster, mailbox, task, and runtime lifecycle owners. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-headless'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamMailbox } from './mailbox.ts'
import { teamProjectionDefinition } from './projection.ts'
import { TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
  TeamModelSelection,
} from './types.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const DEFAULT_MAX_MEMBERS = 16
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000

const modelRouteSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

function normalizeModels(value: readonly TeamModelSelection[] | undefined): TeamModelSelection[] {
  const configured = value ?? []
  if (configured.some(entry => !entry || typeof entry.provider !== 'string' || typeof entry.model !== 'string')) {
    throw new TeamError('Team model routes need provider and model ids', 'TEAM_INVALID_CONFIG')
  }
  const routes = configured.map((entry) => ({ provider: entry.provider.trim(), model: entry.model.trim() }))
  if (routes.some(route => route.provider.length === 0 || route.model.length === 0)) {
    throw new TeamError('Team model routes need non-empty provider and model ids', 'TEAM_INVALID_CONFIG')
  }
  if (new Set(routes.map(route => `${route.provider}\0${route.model}`)).size !== routes.length) {
    throw new TeamError('Team model routes must not contain duplicates', 'TEAM_INVALID_CONFIG')
  }
  return routes
}

function normalizeModel(value: TeamModelSelection | undefined): TeamModelSelection | undefined {
  if (value === undefined) return undefined
  if (typeof value.provider !== 'string' || typeof value.model !== 'string') {
    throw new TeamError('Team default model needs provider and model ids', 'TEAM_INVALID_CONFIG')
  }
  const provider = value.provider.trim()
  const model = value.model.trim()
  if (!provider || !model) throw new TeamError('Team default model needs provider and model ids', 'TEAM_INVALID_CONFIG')
  return { provider, model }
}

function readConfigValue<T>(value: Volatile<T> | T | undefined, fallback: T): T {
  if (value !== undefined && typeof value === 'object' && value !== null
      && 'get' in value && typeof value.get === 'function') return value.get() as T
  return value === undefined ? fallback : value as T
}

interface HostModelSelectionSettings {
  current(): { enabled: boolean; allowedModels: readonly TeamModelSelection[] }
}

/** Read Host route authority structurally, keeping the Team runtime independent of its UI plugin. */
function currentHostModelPolicy(ctx: Context): { enabled: boolean; allowedModels: TeamModelSelection[] } | undefined {
  const provider: unknown = ctx.get('subagentModelSelection')
  if (provider === undefined) return undefined
  if (typeof provider !== 'object' || provider === null || !('current' in provider) || typeof provider.current !== 'function') {
    throw new TeamError('Host model-selection policy service is malformed', 'TEAM_HOST_MODEL_SELECTION_UNAVAILABLE')
  }
  const current = (provider as HostModelSelectionSettings).current()
  if (typeof current.enabled !== 'boolean') {
    throw new TeamError('Host model-selection policy is malformed', 'TEAM_HOST_MODEL_SELECTION_UNAVAILABLE')
  }
  return { enabled: current.enabled, allowedModels: normalizeModels(current.allowedModels) }
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents', 'llm']

  static Config = z.object({
    maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxPendingMessagesPerMember: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
    allowedModels: z.array(modelRouteSchema).default([]).volatile(),
    defaultModel: z.union([z.const(undefined), modelRouteSchema]).volatile(),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Omit<Config, 'defaultModel' | 'allowedModels'>> & {
    allowedModels: Volatile<TeamModelSelection[]> | TeamModelSelection[]
    defaultModel: Volatile<TeamModelSelection | undefined> | TeamModelSelection | undefined
  }

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly mailbox: TeamMailbox
  private readonly tasks: TeamTaskBoard

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxPendingMessagesPerMember: positiveLimit(
        'maxPendingMessagesPerMember',
        config.maxPendingMessagesPerMember ?? DEFAULT_MAX_PENDING_MESSAGES,
      ),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
      allowedModels: config.allowedModels ?? [],
      defaultModel: config.defaultModel,
    }

    this.modelPolicy()
    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.roster = new TeamRoster(
      ctx,
      this.journal,
      this.lifecycle,
      this.config.maxMembers,
      () => this.modelPolicy(),
      () => currentHostModelPolicy(ctx),
    )
    this.mailbox = new TeamMailbox(
      ctx,
      this.journal,
      this.roster,
      this.lifecycle,
      this.config.maxPendingMessagesPerMember,
      this.config.maxMessageBytes,
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)
    ctx.provide('terminalTeamStatus', {
      describe: (agent: Agent): readonly string[] => [
        'Team members:',
        ...this.listMembers(agent).map(member => `  ${member.name}  ${member.role}  ${member.status}${member.model === undefined ? '' : `  ${member.model}`}`),
        'Team tasks:',
        ...this.listTasks(agent).map(task => `  ${task.id}  ${task.status}  ${task.subject}`),
      ],
    })

    ctx.on('session/event', (session, event) => { this.mailbox.observeSessionEvent(session, event) })
    ctx.on('agent/created', ({ agent }) => {
      this.scheduleRecovery(agent)
      return undefined
    })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.effect(() => {
      const disposeProjection = ctx.root.sessionProjections.register(teamProjectionDefinition)
      return async () => {
        try {
          await this.disposeRuntime()
        } finally {
          disposeProjection()
        }
      }
    }, 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Read the live Team-specific provider/model ceiling for settings and admission.
   * @returns the current Team allowlist and optional default route.
   * @throws {TeamError} if Team routes are invalid or the default is not in allowedModels.
   */
  modelPolicy(): { allowedModels: TeamModelSelection[]; defaultModel?: TeamModelSelection } {
    const allowedModels = normalizeModels(readConfigValue(this.config.allowedModels, []))
    const defaultModel = normalizeModel(readConfigValue(this.config.defaultModel, undefined))
    if (defaultModel && !allowedModels.some(route => route.provider === defaultModel.provider && route.model === defaultModel.model)) {
      throw new TeamError('Team default model must be included in the Team allowed-model list', 'TEAM_DEFAULT_MODEL_NOT_ALLOWED')
    }
    return { allowedModels, ...defaultModel ? { defaultModel } : {} }
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    return await this.mailbox.send(caller, request)
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile roster provisioning before retrying that member's pending mailbox. */
  private async recoverFor(agent: Agent): Promise<void> {
    await this.roster.recoverFor(agent, this.lifecycle.signal)
    await this.mailbox.recoverFor(agent, this.lifecycle.signal)
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.roster.pendingCreations(), failures)
    await this.lifecycle.settle(this.mailbox.pendingDispatches(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
