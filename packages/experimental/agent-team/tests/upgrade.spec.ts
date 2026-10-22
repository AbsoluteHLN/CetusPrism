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
import TeamService, { TeamId } from '../src/index.ts'
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
