import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { TeamError, TeamId, TeamMessageId } from '../src/index.ts'
import { teamProjectionDefinition } from '../src/projection.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Detached durable Team state read through the same projection definition as the service. */
function durable(agent: Agent) {
  let projected = teamProjectionDefinition.init(agent.session.header)
  for (const event of agent.session.snapshotEvents()) projected = teamProjectionDefinition.apply(projected, event)
  if (projected.failure !== undefined) throw new Error(projected.failure)
  return projected
}

/** Count the durable deliveries one member received for one Team message identity. */
function deliveries(agent: Agent, messageId: TeamMessageId): number {
  let count = 0
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'agent/inbox/spliced') continue
    for (const inserted of event.data.inserted) {
      if (inserted.source.kind === 'team-message' && inserted.source.messageId === messageId) count += 1
    }
  }
  return count
}

/** Count the prompts one member received that carry the given text. */
function prompts(agent: Agent, text: string): number {
  let count = 0
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'agent/inbox/spliced') continue
    for (const inserted of event.data.inserted) {
      if (inserted.content.some(block => block.type === 'text' && block.text.includes(text))) count += 1
    }
  }
  return count
}

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  config: ConstructorParameters<typeof TeamService>[1] = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-upgrade-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  // Constructor config includes Cordis volatile wrappers; the loader schema accepts plain fixture values.
  const teamFiber = await ctx.plugin(TeamService, config as never)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, adapter, storageRoot, teamFiber }
}

function content(text: string) {
  return [{ type: 'text' as const, text }]
}

function spawn(
  ctx: Context,
  lead: Agent,
  name: string,
  options: { context?: 'fresh' | 'fork'; provider?: string } = {},
) {
  const context = options.context ?? 'fresh'
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: content(`${name} initial`),
    context,
    provider: options.provider ?? (context === 'fork' ? 'fork' : 'spawn'),
    signal: SIGNAL,
  })
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const agent = ctx.agents.get(id)
    expect(agent?.status).toBe('running')
    return agent!
  }, { timeout: 5_000 })
}

/** Append one active member row whose child Session was never persisted. */
function appendUnreachableMember(lead: Agent, name: string): void {
  const member = {
    id: SessionId(`${name}-session`),
    name,
    description: `${name} responsibility`,
    provider: 'spawn',
    context: 'fresh' as const,
  }
  lead.session.append('team/member', {
    version: 2,
    teamId: TeamId(lead.id),
    member: { ...member, phase: 'provisioning' },
  })
  lead.session.append('team/member', {
    version: 2,
    teamId: TeamId(lead.id),
    member: { ...member, phase: 'active' },
  })
}

describe('Team agent profiles', () => {
  it('lists the declared profiles in declaration order', async () => {
    const { ctx } = await setup([], {
      profiles: [
        { id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' },
        {
          id: 'planner',
          name: 'planner',
          description: 'plans work',
          backend: 'fork',
          provider: 'mock',
          model: 'mock-model',
          allowedEfforts: ['low'],
          preset: 'plain',
        },
      ],
    })

    // The Cordis config loader resolves each declared profile, so the effort
    // list is always present and empty when the profile declares none.
    expect(ctx.agentTeams.profiles()).toEqual([
      { id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn', allowedEfforts: [] },
      {
        id: 'planner',
        name: 'planner',
        description: 'plans work',
        backend: 'fork',
        provider: 'mock',
        model: 'mock-model',
        allowedEfforts: ['low'],
        preset: 'plain',
      },
    ])
  })

  it('takes the teammate name, description, and backend from the declared profile', async () => {
    const { ctx, lead } = await setup(['hang'], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })

    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })

    expect(spawned.member).toMatchObject({
      name: 'reviewer',
      description: 'reviews changes',
      provider: 'spawn',
    })
  })

  it('records the declared profile identity on the member row', async () => {
    const { ctx, lead } = await setup(['hang'], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })

    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })

    expect(spawned.member.profileId).toBe('reviewer')
  })

  it('records the declared profile identity in the durable member row', async () => {
    const { ctx, lead } = await setup(['hang'], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })

    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })

    expect(durable(lead).members.find(member => member.id === spawned.member.id)?.profileId).toBe('reviewer')
  })

  it('rejects a profile id that is not declared', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'ghost',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })).rejects.toMatchObject({ name: 'TeamError', code: 'TEAM_PROFILE_UNKNOWN' })
  })

  it('rejects a teammate name that conflicts with the declared profile', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      name: 'other-reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_PROFILE_CONFLICT' })
  })

  it('rejects a model route that conflicts with the declared profile', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{
        id: 'pinned',
        name: 'pinned-worker',
        description: 'runs on a pinned route',
        backend: 'spawn',
        provider: 'mock',
        model: 'mock-model',
      }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'pinned',
      prompt: content('run the pinned route'),
      context: 'fresh',
      agentOptions: { provider: 'mock', model: 'other-model' },
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_PROFILE_CONFLICT' })
  })

  it('rejects a reasoning effort outside the declared profile efforts', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{
        id: 'strict',
        name: 'strict-reviewer',
        description: 'runs on a narrow effort range',
        backend: 'spawn',
        provider: 'mock',
        model: 'mock-model',
        allowedEfforts: ['low'],
      }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'strict',
      prompt: content('review the diff'),
      context: 'fresh',
      agentOptions: { provider: 'mock', model: 'mock-model', reasoningEffort: 'high' },
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_EFFORT_NOT_ALLOWED' })
  })

  it('rejects an execution backend that conflicts with the declared profile backend', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fork',
      provider: 'fork',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_PROFILE_CONFLICT' })
  })

  it('rejects an agent preset that conflicts with the declared profile preset', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{
        id: 'preset-reviewer',
        name: 'preset-reviewer',
        description: 'reviews changes under a preset',
        backend: 'spawn',
        preset: 'plain',
      }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'preset-reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      preset: 'fancy',
      signal: SIGNAL,
    })).rejects.toMatchObject({
      code: 'TEAM_PROFILE_CONFLICT',
      message: expect.stringContaining('preset conflicts with the declared profile "preset-reviewer"'),
    })
  })

  it('accepts an agent preset that matches the declared profile preset', async () => {
    const { ctx, lead } = await setup(['hang'], {
      profiles: [{
        id: 'preset-reviewer',
        name: 'preset-reviewer',
        description: 'reviews changes under a preset',
        backend: 'spawn',
        preset: 'plain',
      }],
    })

    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'preset-reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      preset: 'plain',
      signal: SIGNAL,
    })

    expect(spawned.member.preset).toBe('plain')
    expect(durable(lead).members.find(member => member.id === spawned.member.id)?.preset).toBe('plain')
  })

  it('takes the agent preset from the declared profile when the request names none', async () => {
    const { ctx, lead } = await setup(['hang'], {
      profiles: [{
        id: 'preset-reviewer',
        name: 'preset-reviewer',
        description: 'reviews changes under a preset',
        backend: 'spawn',
        preset: 'plain',
      }],
    })

    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'preset-reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })

    expect(spawned.member.preset).toBe('plain')
    expect(durable(lead).members.find(member => member.id === spawned.member.id)?.preset).toBe('plain')
  })

  it('requires a request backend when the declared profile declares none', async () => {
    const { ctx, lead } = await setup([], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes' }],
    })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('instantiates one declared profile again in another Team', async () => {
    // Pins the profile contract of roster.spawnAdmitted: a declared profile is
    // a reusable identity, the member name it reserves belongs to one Team
    // only, and each Team keeps its own roster rows.
    const { ctx, lead } = await setup(['hang', 'hang'], {
      profiles: [{ id: 'reviewer', name: 'reviewer', description: 'reviews changes', backend: 'spawn' }],
    })
    const otherLead = await ctx.agentLoop.create(SessionId('lead-other'), { provider: 'mock', model: 'mock' })

    const first = await ctx.agentTeams.spawnTeammate(lead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })
    const second = await ctx.agentTeams.spawnTeammate(otherLead, {
      profileId: 'reviewer',
      prompt: content('review the diff'),
      context: 'fresh',
      signal: SIGNAL,
    })

    // Both member rows record the profile they were instantiated from, and
    // they are two distinct instances of it.
    expect(first.member.profileId).toBe('reviewer')
    expect(second.member.profileId).toBe('reviewer')
    expect(second.member.id).not.toBe(first.member.id)
    // The reserved member name lives in the Team that took it, so the other
    // Team may hold the same name.
    expect(durable(lead).members.map(member => member.name)).toEqual(['reviewer'])
    expect(durable(otherLead).members.map(member => member.name)).toEqual(['reviewer'])
    // Neither Team sees the other's row.
    expect(durable(lead).members.map(member => member.id)).toEqual([first.member.id])
    expect(durable(otherLead).members.map(member => member.id)).toEqual([second.member.id])
    expect(ctx.agentTeams.listMembers(lead).map(member => member.id)).toEqual([lead.id, first.member.id])
    expect(ctx.agentTeams.listMembers(otherLead).map(member => member.id)).toEqual([otherLead.id, second.member.id])
  })
})

describe('Team dormant teammates', () => {
  it('releases a teammate into a dormant roster row', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')

    const released = await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })

    expect(released.member).toMatchObject({ name: 'worker', status: 'dormant', resumable: true })
  })

  it('lists a released teammate as dormant and resumable', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })

    const row = ctx.agentTeams.listMembers(lead).find(member => member.name === 'worker')

    expect(row).toMatchObject({ status: 'dormant', resumable: true })
  })

  it('keeps a released teammate in the durable roster', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })

    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('dormant')
  })

  it('resumes a dormant teammate into an active durable row', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })

    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })

    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('active')
  })

  it('does not wake a dormant teammate with mail', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })

    const sent = await ctx.agentTeams.sendMessage(lead, {
      target: 'worker',
      content: content('the review is ready'),
      signal: SIGNAL,
    })

    // The message is durable and queued. Delivering it would have
    // cold-resumed the member, which is the one thing the release is for:
    // a dormant member keeps its identity and runs no turn.
    expect(sent.status).toBe('queued')
    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('dormant')
    expect(durable(lead).delivered).not.toContain(sent.messageId)
  })

  it('delivers the mail that waited for a dormant teammate', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    const sent = await ctx.agentTeams.sendMessage(lead, {
      target: 'worker',
      content: content('the review is ready'),
      signal: SIGNAL,
    })

    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })

    // The member is back, and the mail that waited for it arrives then.
    await vi.waitFor(() => {
      expect(durable(lead).delivered).toContain(sent.messageId)
    }, { timeout: 5_000 })
  })

  it('keeps a teammate dormant when its resume fails', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    vi.spyOn(ctx.subagents, 'sendMessage').mockRejectedValueOnce(new Error('the session is not available'))

    await expect(ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_RESUMABLE' })

    // The member runs nothing, so it goes back to the phase it was released
    // into: a later resume has to be able to bring it back.
    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('dormant')
  })

  it('keeps the original failure as the cause of the thrown resume error', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    const failure = new Error('the session is not available')
    vi.spyOn(ctx.subagents, 'sendMessage').mockRejectedValueOnce(failure)

    const thrown = await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    // One error code still describes the failure, and the error it folded
    // travels with it instead of being flattened into its text.
    expect(thrown).toBeInstanceOf(TeamError)
    expect(thrown).toHaveProperty('cause', failure)
  })

  it('records the resume failure reason on the dormant member row', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    vi.spyOn(ctx.subagents, 'sendMessage').mockRejectedValueOnce(new Error('the session is not available'))

    await expect(ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_RESUMABLE' })

    // The reason outlives the call that reported it: the durable row says
    // why the member went back to sleep, so a restart does not lose it.
    const row = durable(lead).members.find(member => member.name === 'worker')
    expect(row?.phase).toBe('dormant')
    expect(row?.error).toContain('the session is not available')
  })

  it('reports a roster row that could not be parked to the caller', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    vi.spyOn(ctx.subagents, 'sendMessage').mockRejectedValueOnce(new Error('the session is not available'))
    // The journal refuses the parked row, so the durable state keeps calling
    // the member active while its runtime is already gone.
    const append = lead.session.append.bind(lead.session)
    vi.spyOn(lead.session, 'append').mockImplementation(((type: string, data: unknown, ...rest: never[]) => {
      const phase = (data as { member?: { phase?: string } } | undefined)?.member?.phase
      if (type === 'team/member' && phase === 'dormant') throw new Error('the roster journal is unavailable')
      return (append as (...args: never[]) => unknown)(type as never, data as never, ...rest)
    }) as never)

    const thrown = await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    // The caller learns both facts: the resume failed, and the roster could
    // not record that the member is no longer running.
    expect(thrown).toBeInstanceOf(TeamError)
    expect((thrown as TeamError).message).toContain('the session is not available')
    expect((thrown as TeamError).message).toContain('the roster journal is unavailable')
    // The durable row still calls the member active: nothing claimed
    // otherwise, so the roster and the runtime disagree until a later
    // resume reconciles them.
    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('active')
  })

  it('clears the stale resume failure from a member a later resume brings back', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    vi.spyOn(ctx.subagents, 'sendMessage').mockRejectedValueOnce(new Error('the session is not available'))
    await expect(ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_RESUMABLE' })

    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })

    // The member runs again, so the earlier failure no longer describes it.
    const row = durable(lead).members.find(member => member.name === 'worker')
    expect(row?.phase).toBe('active')
    expect(row?.error).toBeUndefined()
  })

  it('rejects a resume for a member that is not dormant', async () => {
    const { ctx, lead } = await setup(['hang'])
    await spawn(ctx, lead, 'worker')

    await expect(ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
  })

  it('rejects a resume for an unknown teammate name', async () => {
    const { ctx, lead } = await setup(['hang'])

    await expect(ctx.agentTeams.resumeTeammate(lead, {
      name: 'ghost',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
  })

  it('counts a dormant teammate against the member limit', async () => {
    // A long-lived teammate must not be a way around the limit: the roster
    // row stays, so the slot it holds stays held.
    const { ctx, lead } = await setup(['hang', 'hang'], { maxMembers: 1 })
    await spawn(ctx, lead, 'worker')
    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'second',
      description: 'a second teammate',
      prompt: content('work'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
  })

  it('permits only the Lead to release a teammate', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)

    await expect(ctx.agentTeams.releaseTeammate(worker, { name: 'worker', signal: SIGNAL }))
      .rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
  })

  it('permits only the Lead to resume a teammate', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)

    await expect(ctx.agentTeams.resumeTeammate(worker, {
      name: 'worker',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
  })

  it('round-trips release and resume, delivering one prompt per resume', async () => {
    // Pins roster.resume: a released member comes back with the identity it
    // was released from, and every resume hands it exactly one prompt.
    const { ctx, lead } = await setup(['hang', 'hang', 'hang'])
    const started = await spawn(ctx, lead, 'worker')
    await waitRunning(ctx, started.member.id)

    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('first resume'),
      signal: SIGNAL,
    })
    const resumed = await waitRunning(ctx, started.member.id)

    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('active')
    expect(prompts(resumed, 'first resume')).toBe(1)

    await ctx.agentTeams.releaseTeammate(lead, { name: 'worker', signal: SIGNAL })
    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('dormant')
    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'worker',
      prompt: content('second resume'),
      signal: SIGNAL,
    })
    const resumedAgain = await waitRunning(ctx, started.member.id)

    expect(durable(lead).members.find(member => member.name === 'worker')?.phase).toBe('active')
    // The second resume delivers its own prompt, and the first one is not
    // delivered a second time.
    expect(prompts(resumedAgain, 'second resume')).toBe(1)
    expect(prompts(resumedAgain, 'first resume')).toBe(1)
  })
})

describe('Team ranges', () => {
  it('rejects a reasoning effort outside the allowed-effort range', async () => {
    const { ctx, lead } = await setup([], { allowedEfforts: ['low'] })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'effort-worker',
      description: 'effort range worker',
      prompt: content('work'),
      context: 'fresh',
      provider: 'spawn',
      agentOptions: { provider: 'mock', model: 'mock-model', reasoningEffort: 'high' },
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_EFFORT_NOT_ALLOWED' })
  })

  it('rejects an execution backend outside the allowed-backend range', async () => {
    const { ctx, lead } = await setup([], { allowedBackends: ['spawn'] })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'backend-worker',
      description: 'backend range worker',
      prompt: content('work'),
      context: 'fork',
      provider: 'fork',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_BACKEND_NOT_ALLOWED' })
  })

  it('rejects an execution backend this deployment does not have, before it takes a name', async () => {
    // The range says which backends this Team allows; the registry says
    // which backends this deployment has. A backend that is allowed but
    // absent used to fail after the member row was written — and a failed
    // member still holds its name and its slot.
    const { ctx, lead } = await setup([], { allowedBackends: ['spawn', 'acp'] })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'absent-backend-worker',
      description: 'a backend this deployment does not have',
      prompt: content('work'),
      context: 'fresh',
      provider: 'acp',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_BACKEND_NOT_AVAILABLE' })

    expect(durable(lead).members.some(member => member.name === 'absent-backend-worker')).toBe(false)
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.role === 'teammate')).toHaveLength(0)
  })

  it('rejects an agent preset outside the allowed-preset range', async () => {
    const { ctx, lead } = await setup([], { allowedPresets: ['plain'] })

    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'preset-worker',
      description: 'preset range worker',
      prompt: content('work'),
      context: 'fresh',
      provider: 'spawn',
      preset: 'fancy',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_PRESET_NOT_ALLOWED' })
  })

  it('accepts an agent preset outside an empty allowed-preset range', async () => {
    const { ctx, lead } = await setup(['hang'], {
      allowedEfforts: [],
      allowedBackends: [],
      allowedPresets: [],
    })

    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'unrestricted-worker',
      description: 'unrestricted range worker',
      prompt: content('work'),
      context: 'fresh',
      provider: 'spawn',
      preset: 'fancy',
      signal: SIGNAL,
    })

    expect(spawned.member.preset).toBe('fancy')
  })

  it('reads the current Team ranges', async () => {
    const { ctx } = await setup([], {
      allowedEfforts: ['low', 'medium'],
      allowedBackends: ['spawn'],
      allowedPresets: ['plain'],
    })

    expect(ctx.agentTeams.ranges()).toEqual({
      allowedEfforts: ['low', 'medium'],
      allowedBackends: ['spawn'],
      allowedPresets: ['plain'],
    })
  })
})

describe('Team broadcast', () => {
  it('delivers one broadcast to every named teammate', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const alpha = await spawn(ctx, lead, 'alpha')
    const beta = await spawn(ctx, lead, 'beta')
    const alphaAgent = await waitRunning(ctx, alpha.member.id)
    const betaAgent = await waitRunning(ctx, beta.member.id)

    const broadcast = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['alpha', 'beta'],
      content: content('status please'),
      signal: SIGNAL,
    })

    expect([
      alphaAgent.inbox.nextStep.some(item => item.source.kind === 'team-message'
        && item.source.messageId === broadcast.messageId),
      betaAgent.inbox.nextStep.some(item => item.source.kind === 'team-message'
        && item.source.messageId === broadcast.messageId),
    ]).toEqual([true, true])
  })

  it('reports the broadcast identity, targets, and delivery status', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const alpha = await spawn(ctx, lead, 'alpha')
    const beta = await spawn(ctx, lead, 'beta')
    await waitRunning(ctx, alpha.member.id)
    await waitRunning(ctx, beta.member.id)

    const broadcast = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['alpha', 'beta'],
      content: content('status please'),
      signal: SIGNAL,
    })

    expect(broadcast).toMatchObject({
      status: 'accepted',
      targetIds: [alpha.member.id, beta.member.id],
    })
  })

  it('records the broadcast in the durable projection', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const alpha = await spawn(ctx, lead, 'alpha')
    const beta = await spawn(ctx, lead, 'beta')
    await waitRunning(ctx, alpha.member.id)
    await waitRunning(ctx, beta.member.id)

    const broadcast = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['alpha', 'beta'],
      content: content('status please'),
      signal: SIGNAL,
    })

    expect(durable(lead).broadcasts.map(candidate => candidate.id)).toEqual([broadcast.messageId])
  })

  it('records one delivery edge per broadcast target in the durable projection', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const alpha = await spawn(ctx, lead, 'alpha')
    const beta = await spawn(ctx, lead, 'beta')
    await waitRunning(ctx, alpha.member.id)
    await waitRunning(ctx, beta.member.id)

    await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['alpha', 'beta'],
      content: content('status please'),
      signal: SIGNAL,
    })

    expect(durable(lead).broadcastDelivered.map(edge => edge.targetId))
      .toEqual([alpha.member.id, beta.member.id])
  })

  it('rejects a broadcast that targets the caller itself', async () => {
    const { ctx, lead } = await setup(['hang'])

    await expect(ctx.agentTeams.broadcastMessage(lead, {
      targets: ['lead'],
      content: content('talk to myself'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_SELF_MESSAGE' })
  })

  it('rejects a broadcast without targets', async () => {
    const { ctx, lead } = await setup(['hang'])

    await expect(ctx.agentTeams.broadcastMessage(lead, {
      targets: [],
      content: content('nobody hears this'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('counts every expanded broadcast target against that target pending ceiling', async () => {
    const { ctx, lead } = await setup([], { maxPendingMessagesPerMember: 1 })
    appendUnreachableMember(lead, 'ghost-a')
    appendUnreachableMember(lead, 'ghost-b')

    const first = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['ghost-a', 'ghost-b'],
      content: content('first broadcast'),
      signal: SIGNAL,
    })

    expect(first.status).toBe('queued')
  })

  it('rejects a broadcast whose expanded target already holds a pending broadcast', async () => {
    const { ctx, lead } = await setup([], { maxPendingMessagesPerMember: 1 })
    appendUnreachableMember(lead, 'ghost-a')
    appendUnreachableMember(lead, 'ghost-b')
    await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['ghost-a', 'ghost-b'],
      content: content('first broadcast'),
      signal: SIGNAL,
    })

    await expect(ctx.agentTeams.broadcastMessage(lead, {
      targets: ['ghost-b'],
      content: content('second broadcast'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MAILBOX_FULL' })
  })

  it('keeps the broadcast ceiling independent from the ordinary message ceiling', async () => {
    const { ctx, lead } = await setup([], { maxPendingMessagesPerMember: 1 })
    appendUnreachableMember(lead, 'ghost')
    await ctx.agentTeams.sendMessage(lead, {
      target: 'ghost',
      content: content('ordinary message'),
      signal: SIGNAL,
    })

    const broadcast = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['ghost'],
      content: content('broadcast'),
      signal: SIGNAL,
    })

    expect(broadcast.status).toBe('queued')
  })

  it('keeps the delivered edge and re-delivers only the failed target', async () => {
    // Pins the partial-failure contract of one broadcast: the target that
    // received it keeps its delivery edge, the target that did not stays
    // pending, and the recovery that follows re-delivers to that target only.
    const { ctx, lead } = await setup(['hang', 'hang', 'hang'])
    const alpha = await spawn(ctx, lead, 'alpha')
    const beta = await spawn(ctx, lead, 'beta')
    const alphaAgent = await waitRunning(ctx, alpha.member.id)
    await waitRunning(ctx, beta.member.id)
    // A released teammate keeps its identity but has no runtime left, so the
    // broadcast cannot reach it.
    await ctx.agentTeams.releaseTeammate(lead, { name: 'beta', signal: SIGNAL })

    const broadcast = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['alpha', 'beta'],
      content: content('status please'),
      signal: SIGNAL,
    })

    // The delivery stopped at the released target: the broadcast still owes
    // that target a delivery, and the target that received it keeps its edge.
    expect(broadcast.status).toBe('queued')
    expect(durable(lead).broadcasts.find(candidate => candidate.id === broadcast.messageId)?.targetIds)
      .toEqual([alpha.member.id, beta.member.id])
    expect(durable(lead).broadcastDelivered.map(edge => edge.targetId)).toEqual([alpha.member.id])
    expect(deliveries(alphaAgent, broadcast.messageId)).toBe(1)

    // The resume cold-resumes the released member, and the recovery that
    // follows it retries the pending broadcast for that target only.
    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'beta',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })
    const betaAgent = await waitRunning(ctx, beta.member.id)

    await vi.waitFor(() => {
      expect(durable(lead).broadcastDelivered.map(edge => edge.targetId))
        .toEqual([alpha.member.id, beta.member.id])
    }, { timeout: 2_000 })
    // The target that already received it is not delivered to a second time.
    expect(deliveries(alphaAgent, broadcast.messageId)).toBe(1)
    expect(deliveries(betaAgent, broadcast.messageId)).toBe(1)
  })

  it('delivers a broadcast past an unreachable target in the same drive', async () => {
    // The target order must not decide who is served: an unreachable target
    // at the head keeps its message queued, and the reachable target after
    // it is still delivered by this drive.
    const { ctx, lead } = await setup(['hang', 'hang', 'hang'])
    const alpha = await spawn(ctx, lead, 'alpha')
    const beta = await spawn(ctx, lead, 'beta')
    const alphaAgent = await waitRunning(ctx, alpha.member.id)
    await waitRunning(ctx, beta.member.id)
    // A released teammate keeps its identity but has no runtime left, so the
    // broadcast cannot reach it.
    await ctx.agentTeams.releaseTeammate(lead, { name: 'beta', signal: SIGNAL })

    const broadcast = await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['beta', 'alpha'],
      content: content('status please'),
      signal: SIGNAL,
    })

    // The unreachable target still owes its delivery, so the broadcast stays
    // queued and no delivery edge is written for it — but the reachable
    // target after it is not held back by that failure.
    expect(broadcast.status).toBe('queued')
    expect(durable(lead).broadcastDelivered.map(edge => edge.targetId)).toEqual([alpha.member.id])
    expect(deliveries(alphaAgent, broadcast.messageId)).toBe(1)

    // The resume cold-resumes the released member, and the recovery that
    // follows it retries the pending broadcast for that target only.
    await ctx.agentTeams.resumeTeammate(lead, {
      name: 'beta',
      prompt: content('continue the review'),
      signal: SIGNAL,
    })
    const betaAgent = await waitRunning(ctx, beta.member.id)

    await vi.waitFor(() => {
      expect(durable(lead).broadcastDelivered.map(edge => edge.targetId))
        .toEqual([alpha.member.id, beta.member.id])
    }, { timeout: 2_000 })
    // The target that already received it is not delivered to a second time.
    expect(deliveries(alphaAgent, broadcast.messageId)).toBe(1)
    expect(deliveries(betaAgent, broadcast.messageId)).toBe(1)
  })
})

describe('Team mailbox ceilings', () => {
  it('rejects an ordinary message that exceeds the ordinary pending ceiling', async () => {
    const { ctx, lead } = await setup([], { maxPendingMessagesPerMember: 1 })
    appendUnreachableMember(lead, 'ghost')
    await ctx.agentTeams.sendMessage(lead, {
      target: 'ghost',
      content: content('ordinary message'),
      signal: SIGNAL,
    })

    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'ghost',
      content: content('second ordinary message'),
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MAILBOX_FULL' })
  })
})

describe('Team unreachable members', () => {
  it('keeps an unreachable member out of the delivered broadcast edges', async () => {
    const { ctx, lead } = await setup(['hang'])
    appendUnreachableMember(lead, 'ghost')

    await ctx.agentTeams.broadcastMessage(lead, {
      targets: ['ghost'],
      content: content('nobody hears this'),
      signal: SIGNAL,
    })

    expect(durable(lead).broadcastDelivered).toEqual([])
  })
})
