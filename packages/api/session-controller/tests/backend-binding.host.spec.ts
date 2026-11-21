/**
 * Session creation binds the execution backend the host selected.
 *
 * The backend owns the Agent lifecycle, so the binding is made when the
 * session is created — never afterwards — and it is recorded in the session's
 * OWN log, because that record is what a resume reads back to rebuild the
 * same driver.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentDriverFactory, AgentFactory } from '@deepseek-ai/dsh-agent'
import { agentBackendProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { ApiSessionAgentController } from '../src/agent.ts'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

/** Booted contexts and their temp roots, torn down after each test. */
const contexts: Context[] = []
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

/** The driver the host hands out for the external backend. */
const PI_DRIVER: AgentDriverFactory = () => {
  throw new Error('the test driver is never constructed')
}

/** The roster stub, with the backend selection the host published. */
function roster(backend: 'dsh' | 'pi' | 'zcode'): unknown {
  return {
    defaultId: 'standard',
    resolve: () => Promise.resolve({ id: 'standard', trust: 'system' }),
    mount: () => Promise.resolve({ id: 'standard', trust: 'system' }),
    currentBackend: () => backend,
    backendDriver: (id: 'dsh' | 'pi' | 'zcode') => (id === 'dsh' ? undefined : PI_DRIVER),
  }
}

async function harness(backend: 'dsh' | 'pi' | 'zcode') {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-session-backend-')))
  tempDirs.push(cwd)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.provide('agentPresets', roster(backend) as never)

  const bound: (AgentDriverFactory | undefined)[] = []
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      bound.push(options.driver)
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      ;(agent as { ctx?: Context }).ctx = ctx
      await options.setup?.(ctx, agent)
      const unregister = await ctx.agents.register(agent)
      return { agent, dispose: async () => { await unregister() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  ctx.sessionProjections.register(agentBackendProjectionDefinition)
  return { ctx, remote, bound }
}

describe('session.create execution backend binding', () => {
  it('binds the external driver when the host selected an external backend', async () => {
    const { remote, bound } = await harness('pi')

    await remote.create({ sessionId: SessionId('backend-pi') })

    expect(bound).toHaveLength(1)
    expect(bound[0]).toBe(PI_DRIVER)
  })

  it('records the binding in the session log, so a resume can rebuild it', async () => {
    const { ctx, remote } = await harness('pi')

    await remote.create({ sessionId: SessionId('backend-log') })

    const session = ctx.sessions.get(SessionId('backend-log'))
    const record = session?.snapshotEvents().find(event => event.type === 'agent-backend/selected')
    expect(record?.type === 'agent-backend/selected' && record.data.agentBackend).toBe('pi')
    expect(ctx.sessionProjections.stateOf(session!, 'agentBackend')).toBe('pi')
  })

  it('binds no driver and records nothing for the native backend', async () => {
    const { ctx, remote, bound } = await harness('dsh')

    await remote.create({ sessionId: SessionId('backend-dsh') })

    expect(bound[0]).toBeUndefined()
    const session = ctx.sessions.get(SessionId('backend-dsh'))
    expect(session?.snapshotEvents().some(event => event.type === 'agent-backend/selected')).toBe(false)
    expect(ctx.sessionProjections.stateOf(session!, 'agentBackend')).toBeNull()
  })
})

describe('backendForObservation hardening', () => {
  it('falls back to the native loop for an unknown recorded backend', async () => {
    const { ctx } = await harness('pi')
    const controller = new ApiSessionAgentController(ctx)
    const observationWith = (agentBackend: unknown): Parameters<ApiSessionAgentController['backendForObservation']>[0] =>
      ({ projections: { values: { agentBackend } } }) as Parameters<ApiSessionAgentController['backendForObservation']>[0]

    expect(controller.backendForObservation(observationWith('pi'))).toBe('pi')
    expect(controller.backendForObservation(observationWith('dsh'))).toBe('dsh')
    // A session without a record ran on the native loop.
    expect(controller.backendForObservation(observationWith(null))).toBeUndefined()
    expect(controller.backendForObservation(observationWith(undefined))).toBeUndefined()
    // A record the registry never issued falls back instead of failing the resume.
    expect(controller.backendForObservation(observationWith('quantum-loop'))).toBeUndefined()
  })
})
