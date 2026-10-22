/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import { TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import type { AgentProfileView, TeamMemberView } from '@deepseek-ai/dsh-experimental-agent-team'
import { registerListSubagentModels } from '@deepseek-ai/dsh-tool-subagent/list-models'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt']

/** Tool routing configuration. */
export interface Config {
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
  /** Expose and enforce the shared Host model allowlist for Team members. */
  readonly modelSelectionSettings?: boolean
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
  modelSelectionSettings: z.boolean().default(false),
})

/** Public route fields shared with the Subagent model-selection setting. */
interface AllowedModelRoute {
  readonly provider: string
  readonly model: string
}

interface TeamModelPolicy {
  readonly allowedModels: readonly AllowedModelRoute[]
  readonly defaultModel?: AllowedModelRoute
}

interface TeamModelPolicyService {
  modelPolicy(): TeamModelPolicy
}

/** Read the current source contract while workspace package declarations rebuild. */
function currentTeamModelPolicy(ctx: Context): TeamModelPolicy {
  return (ctx.agentTeams as Context['agentTeams'] & TeamModelPolicyService).modelPolicy()
}

interface TeamAgentSelection extends AllowedModelRoute {
  readonly reasoningEffort?: string
}

/** Minimal service view used when the optional shared setting is installed. */
interface TeamModelSelectionSettings {
  current(): { enabled: boolean; allowedModels: readonly AllowedModelRoute[] }
}

/**
 * Read the Team's own contribution to the shared discovery policy.
 *
 * The Team narrows the Host allowlist with its own restriction list, and both
 * lists are read per call so a live change narrows the catalog at once. The
 * returned routes are this Team's contribution only: the scope intersects them
 * with every other owner of the same discovery tool.
 * @param ctx - Context owning the Host model-selection setting and the Team policy.
 * @returns The routes this Team authorizes for child model selection.
 */
function teamDiscoveryPolicy(ctx: Context): { readonly routes: readonly AllowedModelRoute[] } {
  const settings: TeamModelSelectionSettings | undefined = ctx.get('subagentModelSelection')
  if (settings === undefined) {
    throw new Error('Team model selection is unavailable because its settings service is not loaded')
  }
  const current = settings.current()
  if (!current.enabled) throw new Error('Team model selection is disabled in settings')
  const teamPolicy = currentTeamModelPolicy(ctx)
  return {
    routes: current.allowedModels.filter(route => teamPolicy.allowedModels.length === 0
      || teamPolicy.allowedModels.some(candidate => candidate.provider === route.provider && candidate.model === route.model)),
  }
}

/** Resolve an explicit Team member route against the Host-owned allowlist. */
function resolveTeamAgentOptions(
  ctx: Context,
  provider: string | undefined,
  model: string | undefined,
  reasoningEffort: string | undefined,
  parent: Agent,
): TeamAgentSelection | undefined {
  const teamPolicy = currentTeamModelPolicy(ctx)
  const hasExplicitSelection = provider !== undefined || model !== undefined || reasoningEffort !== undefined
  const hasTeamSelection = teamPolicy.defaultModel !== undefined || teamPolicy.allowedModels.length > 0
  if (!hasExplicitSelection && !hasTeamSelection) return undefined
  if ((provider === undefined) !== (model === undefined)
      || provider?.trim() === '' || model?.trim() === '' || reasoningEffort?.trim() === '') {
    throw new Error('Team model selection requires provider and model together')
  }
  const settings: TeamModelSelectionSettings | undefined = ctx.get('subagentModelSelection')
  if (settings === undefined) {
    throw new Error('Team model selection is unavailable because its settings service is not loaded')
  }
  const current = settings.current()
  if (!current.enabled) throw new Error('Team model selection is disabled in settings')
  const leadOptions = parentAgentOptionsForDelegation(parent)
  const leadRoute = { provider: leadOptions.provider ?? '', model: leadOptions.model ?? '' }
  const route: AllowedModelRoute = {
    provider: provider ?? (reasoningEffort !== undefined ? leadRoute.provider : teamPolicy.defaultModel?.provider ?? leadRoute.provider),
    model: model ?? (reasoningEffort !== undefined ? leadRoute.model : teamPolicy.defaultModel?.model ?? leadRoute.model),
  }
  if (!route.provider || !route.model) throw new Error('Team model selection needs an effective provider and model')
  if (!current.allowedModels.some(candidate => candidate.provider === route.provider && candidate.model === route.model)) {
    throw new Error(`Team model route "${route.provider}/${route.model}" is not authorized in settings`)
  }
  if (teamPolicy.allowedModels.length > 0
      && !teamPolicy.allowedModels.some(candidate => candidate.provider === route.provider && candidate.model === route.model)) {
    throw new Error(`Team model route "${route.provider}/${route.model}" is outside this Team's additional restriction list`)
  }
  return { ...route, ...reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort.trim() } }
}

/** Model-facing collaboration guidance shared by Lead and teammates. */
const POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message and interrupt_agent, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. dormant means the member was released and keeps its identity but runs no turn: a dormant target is neither running nor inactive, and send_message does not wake it. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. broadcast_message delivers one durable message to several members at once; each target keeps its own delivery edge. release_teammate parks a member as dormant and reactivate_teammate gives a dormant member its next task; mail sent to a dormant member waits in the durable queue and arrives when reactivate_teammate brings it back. list_agent_profiles lists the declared profiles of this deployment, and spawn_teammate with profile_id instantiates one of them by id instead of naming a new member. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again. A dormant teammate needs reactivate_teammate, not send_message: its mail waits until it is back.'

/**
 * One model-facing roster row. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 *
 * `dormant` marks a released member that keeps its identity, `resumable`
 * marks a member a reactivate can bring back, and `profile_id` and `preset`
 * name the declared profile and the preset behind the member.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'dormant', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    modelProvider: { type: 'string' },
    reasoningEffort: { type: 'string' },
    profile_id: { type: 'string' },
    preset: { type: 'string' },
    resumable: { type: 'boolean' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Expose the member name as its model-facing target. */
function modelMember(member: TeamMemberView): InferValue<typeof MEMBER_VIEW_SCHEMA> {
  const { id: _id, name, profileId, ...details } = member
  return {
    target: name,
    ...details,
    ...profileId === undefined ? {} : { profile_id: profileId },
  }
}

/**
 * One declared agent profile, as the model sees it.
 *
 * A profile is a deployment fact rather than a session fact: it names the
 * member, says what it is for, and pins the backend and route it runs under.
 */
const PROFILE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    backend: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    allowed_efforts: { type: 'array', items: { type: 'string' } },
    preset: { type: 'string' },
  },
} as const

/** Expose one declared profile under its model-facing field names. */
function modelProfile(profile: AgentProfileView): InferValue<typeof PROFILE_VIEW_SCHEMA> {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    ...profile.backend === undefined ? {} : { backend: profile.backend },
    ...profile.provider === undefined ? {} : { provider: profile.provider },
    ...profile.model === undefined ? {} : { model: profile.model },
    ...profile.allowedEfforts === undefined ? {} : { allowed_efforts: [...profile.allowedEfforts] },
    ...profile.preset === undefined ? {} : { preset: profile.preset },
  }
}

/**
 * Name the members one broadcast reached.
 *
 * The service answers with member session ids, but the model addresses
 * members by their durable name, so the receipt names them instead of
 * exposing an id the model cannot use.
 * @param members - roster rows visible to the sender.
 * @param targetIds - resolved broadcast targets, in broadcast order.
 * @param requested - requested target names, in request order.
 * @returns the reached member names in broadcast order.
 */
function modelBroadcastTargets(
  members: readonly TeamMemberView[],
  targetIds: readonly TeamMemberView['id'][],
  requested: readonly string[],
): string[] {
  const names: string[] = []
  for (const [index, id] of targetIds.entries()) {
    const name = members.find(member => member.id === id)?.name ?? requested[index]
    if (name !== undefined) names.push(name)
  }
  return names
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

/** One member row returned by a release or a reactivate. */
const LIFECYCLE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const PROFILE_LIST_VALUE_SCHEMA = { type: 'array', items: PROFILE_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['accepted', 'queued'] },
  },
} as const

/** One broadcast receipt; the reached members are named, never identified by Session id. */
const BROADCAST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    targets: { type: 'array', required: true, items: { type: 'string' } },
    status: { type: 'string', required: true, enum: ['accepted', 'queued'] },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    if (config.modelSelectionSettings) {
      // The Team owns one policy in the scope's shared discovery tool; another
      // owner of the same scope (a delegation tool) narrows the same catalog.
      register(registerListSubagentModels(scoped, () => teamDiscoveryPolicy(ctx)))
    }
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: POLICY,
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool.'
        + ' Give profile_id to instantiate a declared agent profile: a profile is a deployment-declared reusable identity that can be addressed by id across sessions, and it owns the member name, description, and route, so name and description must be omitted with it.'
        + ' backend is the execution backend that runs the teammate, such as spawn or fork; provider is the LLM provider of its model route, and the two name different things.'
        + ' preset records the agent preset this member is created under, and is limited to the Team allowed-preset range; the Session that owns the member decides which preset it actually runs under.'
        + (config.modelSelectionSettings
          ? ' provider and model may select one exact route from the Host-authorized list and the Team restriction list. Use list_subagent_models to inspect each model’s advertised reasoning efforts; omit reasoning_effort to use that model’s default. Omit all three to use the Team default when configured, otherwise inherit the Lead route.'
          : ''),
      parameters: {
        name: { type: 'string', description: 'Unique lower-kebab-case teammate name. Required unless profile_id declares the name.' },
        description: { type: 'string', description: 'Short description of the delegated responsibility. Required unless profile_id declares the description.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        model: {
          type: 'string',
          description: 'Optional model id; when configured it must be in the Team allowed-model list.',
        },
        provider: {
          type: 'string',
          description: 'Authorized LLM provider id for the teammate model route; it is not the execution backend. Supply together with model.',
        },
        backend: {
          type: 'string',
          description: 'Execution backend that runs the teammate, such as spawn or fork; it is not the LLM provider. Defaults to the configured fresh or fork backend.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Optional exact effort id advertised by the selected model; without a provider/model pair it applies to the Lead route.',
        },
        profile_id: {
          type: 'string',
          description: 'Declared agent profile to instantiate. A profile is a deployment-declared reusable identity, addressable by id across sessions; it owns the name, description, and route, so omit name and description with it.',
        },
        preset: {
          type: 'string',
          description: 'Agent preset this member is created under, recorded and range-checked by the Team; the owning Session decides which preset it actually runs under. Must be inside the Team allowed-preset range and name a preset id this deployment declared; an undeclared id is recorded but does not take effect. A declared profile pins its own preset, so naming a profile and a different preset is a conflict.',
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const profileId = args.profile_id?.trim()
        const declaredProfile = profileId === undefined
          ? undefined
          : ctx.agentTeams.profiles().find(profile => profile.id === profileId)
        const memberName = declaredProfile?.name ?? args.name?.trim() ?? ''
        if (profileId === undefined) {
          if (memberName === '') throw new Error('spawn_teammate requires a name when no profile_id is given')
          if (args.description === undefined || args.description.trim() === '') {
            throw new Error('spawn_teammate requires a description when no profile_id is given')
          }
        }
        if (!config.modelSelectionSettings
            && (args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined)) {
          throw new Error('Team model selection is disabled in settings')
        }
        const teamModelPolicy = currentTeamModelPolicy(ctx)
        if (!config.modelSelectionSettings
            && (teamModelPolicy.allowedModels.length > 0 || teamModelPolicy.defaultModel !== undefined)) {
          throw new Error('Team-specific model restrictions require model selection to be enabled in settings')
        }
        const agentOptions = config.modelSelectionSettings
          ? resolveTeamAgentOptions(ctx, args.provider, args.model, args.reasoning_effort, agent)
          : undefined
        // A declared profile owns its backend, so the Team default would read as
        // a conflicting backend request against that profile.
        const backend = args.backend
          ?? (declaredProfile?.backend === undefined
            ? (context === 'fork' ? config.forkProvider : config.freshProvider)
            : undefined)
        const result = await ctx.agentTeams.spawnTeammate(agent, {
          ...args.name === undefined ? {} : { name: args.name },
          ...args.description === undefined ? {} : { description: args.description },
          prompt: [
            { type: 'text', text: `<system-reminder>
You are teammate "${memberName}".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>

` },
            { type: 'text', text: args.prompt },
          ],
          context,
          ...backend === undefined ? {} : { provider: backend },
          ...agentOptions === undefined ? {} : { agentOptions },
          ...args.model === undefined ? {} : { model: args.model },
          ...profileId === undefined ? {} : { profileId },
          ...args.preset === undefined ? {} : { preset: args.preset },
          signal: exec.signal,
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one durable message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn. A dormant target stays parked: the message is queued and arrives when reactivate_teammate brings the member back.',
      parameters: {
        target: { type: 'string', required: true, description: 'Member target returned by spawn_teammate or list_agents, including lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      execute(args, exec) {
        return ctx.agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'broadcast_message',
      description: 'Deliver one durable message to several Team members at once. Every target keeps its own delivery edge and its own pending-message ceiling, so the ceiling counts the expanded target set.',
      parameters: {
        targets: { type: 'array', required: true, items: { type: 'string' }, description: 'Member targets that receive the message, at least one.' },
        message: { type: 'string', required: true, description: 'Self-contained message for every target.' },
      },
      output: jsonOutput(BROADCAST_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'broadcast_message')
        if (args.targets.length === 0) throw new Error('broadcast_message needs at least one target')
        const result = await ctx.agentTeams.broadcastMessage(agent, {
          targets: args.targets,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
        return {
          messageId: result.messageId,
          targets: modelBroadcastTargets(ctx.agentTeams.listMembers(agent), result.targetIds, args.targets),
          status: result.status,
        }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. dormant means the member was released and keeps its identity until it is reactivated. provisioning and failed describe member creation.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')).map(modelMember))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agent_profiles',
      description: 'List the agent profiles this deployment declares. A profile is a reusable teammate identity that can be instantiated in any Team and addressed by id across sessions.',
      parameters: {},
      output: jsonOutput(PROFILE_LIST_VALUE_SCHEMA),
      execute(_args, _exec) {
        return Promise.resolve(ctx.agentTeams.profiles().map(modelProfile))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, mailbox, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'interrupt_agent',
      description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate target returned by spawn_teammate or list_agents.' },
      },
      output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
      execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.interrupt(callingAgent(exec.agent, 'interrupt_agent'), args.target))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'release_teammate',
      description: 'Release one resident teammate into the dormant state. The member keeps its durable identity and the profile identity behind it, so reactivate_teammate can bring the same teammate back later instead of spawning a new one. Team Lead only.',
      parameters: {
        name: { type: 'string', required: true, description: 'Teammate name returned by spawn_teammate or list_agents.' },
      },
      output: jsonOutput(LIFECYCLE_VALUE_SCHEMA),
      async execute(args, exec) {
        const result = await ctx.agentTeams.releaseTeammate(callingAgent(exec.agent, 'release_teammate'), {
          name: args.name,
          signal: exec.signal,
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'reactivate_teammate',
      description: 'Bring one dormant teammate back and give it its next task. The member is cold-resumed with its identity and history intact, and the mail that waited for it arrives then. Team Lead only.',
      parameters: {
        name: { type: 'string', required: true, description: 'Dormant teammate name returned by list_agents or release_teammate.' },
        prompt: { type: 'string', required: true, description: 'Complete next task for the resumed teammate.' },
      },
      output: jsonOutput(LIFECYCLE_VALUE_SCHEMA),
      async execute(args, exec) {
        const result = await ctx.agentTeams.resumeTeammate(callingAgent(exec.agent, 'reactivate_teammate'), {
          name: args.name,
          prompt: [{ type: 'text', text: args.prompt }],
          signal: exec.signal,
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
    modelSelectionSettings: config.modelSelectionSettings ?? false,
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => {
    maybeInstall(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
}
