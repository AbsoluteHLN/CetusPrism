/**
 * The `computerDelivery` projection unit and the `/foreground` command:
 * mounting the delivery-policy service beside the projection registry serves
 * only the effective mode folded from `computer-use/delivery` events over the
 * composition default; the command child registers `/foreground` whose
 * handler switches through the event write path (bare invocation reports,
 * unknown modes error). The service requires the projection registry and
 * omits the command without its registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import ComputerUseDeliveryPolicy, {
  setComputerUseDelivery,
} from '@deepseek-ai/dsh-computer-use-policy'

async function harness(config: { defaultMode?: 'allow-foreground' | 'background-only' } = {}): Promise<{
  ctx: Context
  session: Session
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(ComputerUseDeliveryPolicy, config)
  return { ctx, session: ctx.sessions.create(SessionId('delivery-projected')) }
}

describe('computerDelivery projection unit', () => {
  it('serves the composition default before any override', async () => {
    const { ctx, session } = await harness()
    expect(ctx.sessionProjections.snapshot(session).values.computerDelivery)
      .toEqual({ mode: 'allow-foreground' })
  })

  it('honors a configured composition default', async () => {
    const { ctx, session } = await harness({ defaultMode: 'background-only' })
    expect(ctx.computerUseDeliveryPolicy.defaultMode).toBe('background-only')
    expect(ctx.sessionProjections.snapshot(session).values.computerDelivery)
      .toEqual({ mode: 'background-only' })
  })

  it('folds the override event over the default and notifies the change feed', async () => {
    const { ctx, session } = await harness()
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    setComputerUseDelivery(session, 'background-only')
    expect(changes.filter(change => change.key === 'computerDelivery')).toEqual([
      { key: 'computerDelivery', value: { mode: 'background-only' }, seq: 0 },
    ])
    session.append('turn/start', { turn: 1 })
    expect(changes).toHaveLength(1)
    expect(ctx.sessionProjections.snapshot(session).values.computerDelivery)
      .toEqual({ mode: 'background-only' })
  })

  it('keeps two sessions isolated and resolves the effective mode per call', async () => {
    const { ctx, session } = await harness({ defaultMode: 'background-only' })
    const other = ctx.sessions.create(SessionId('delivery-other'))
    setComputerUseDelivery(session, 'allow-foreground')

    expect(ctx.computerUseDeliveryPolicy.modeOf(session)).toBe('allow-foreground')
    expect(ctx.computerUseDeliveryPolicy.modeOf(other)).toBe('background-only')
  })

  it('is absent without the policy service', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('delivery-absent'))
    expect('computerDelivery' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('/foreground command', () => {
  it('reports the current delivery on bare invocation', async () => {
    const { ctx, session } = await harness()
    const agent = { id: session.id, session } as Agent
    await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))

    const execution = await ctx.commands.execute(agent, '/foreground', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'current delivery allow-foreground' })
  })

  it('switches through the event write path and resolves the mode', async () => {
    const { ctx, session } = await harness()
    const agent = { id: session.id, session } as Agent
    await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))

    const execution = await ctx.commands.execute(agent, '/foreground background-only', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'delivery background-only' })
    expect(ctx.computerUseDeliveryPolicy.modeOf(session)).toBe('background-only')
    const run = session.snapshotEvents().find(event => event.type === 'command/run')
    expect(run?.data).toMatchObject({ name: 'foreground', args: ' background-only' })
    expect(recordedMode(session)).toBe('background-only')
  })

  it('rejects an unknown mode without touching the log', async () => {
    const { ctx, session } = await harness()
    const agent = { id: session.id, session } as Agent
    await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))

    const before = session.snapshotEvents().filter(event =>
      event.type !== 'command/run' && event.type !== 'command/done')
    const execution = await ctx.commands.execute(agent, '/foreground yolo', [], new AbortController().signal)
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'unknown delivery "yolo" (available: allow-foreground, background-only)',
    })
    expect(recordedMode(session)).toBeUndefined()
    expect(session.snapshotEvents().filter(event =>
      event.type !== 'command/run' && event.type !== 'command/done')).toEqual(before)
  })

  it('mounts the projection without a command registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ComputerUseDeliveryPolicy)
    const session = ctx.sessions.create(SessionId('delivery-commandless'))
    setComputerUseDelivery(session, 'background-only')
    expect(ctx.computerUseDeliveryPolicy.modeOf(session)).toBe('background-only')
  })
})

/** The session's recorded `computer-use/delivery` payload, if any. */
function recordedMode(session: Session): string | undefined {
  const event = session.snapshotEvents().find(item => item.type === 'computer-use/delivery')
  return event?.data && typeof event.data === 'object' && 'mode' in event.data
    ? (event.data as { mode?: string }).mode
    : undefined
}
