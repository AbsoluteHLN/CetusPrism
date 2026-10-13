/** Exercises native adapter ownership against the production Agent factory and loop. */
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { defineBuiltinAgent, prepareBuiltinAgent, resolveBuiltinAgent } from '../src/index.ts'
import { contribution, declare, harness } from './harness.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})
const declaration = defineBuiltinAgent({
  id: 'native-test', enabled: true, driver: 'native', version: '1',
  source: 'test', compatibility: { protocolVersion: 1 },
})
const request = { sessionId: SessionId('builtin-test'), provider: 'mock', model: 'chosen-model' }
const prompt = () => createUserMessage({ content: [{ type: 'text', text: 'inspect' }], source: { kind: 'user' } })

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], presets = false) {
  const ctx = await harness({ presets })
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  return { ctx, adapter }
}

it('keeps a prepared Agent alive, executes once on the explicit route, and releases it idempotently', async () => {
  const { ctx, adapter } = await setup([textResponse('native complete')])
  const prepared = await prepareBuiltinAgent(ctx, declaration, request)
  expect(ctx.agents.get(request.sessionId)?.session).toBe(prepared.session)
  expect(adapter.requests).toHaveLength(0)
  const result = await prepared.execute(prompt())
  expect(adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'chosen-model' })
  expect(result.turnEnds).toEqual([expect.objectContaining({ reason: { kind: 'completed' } })])
  expect(result.failures).toEqual([])
  expect(result.liveErrors).toEqual([])
  expect(JSON.stringify(result.events)).toContain('native complete')
  await expect(prepared.execute(prompt())).rejects.toThrow('already owns an execution')
  await Promise.all([prepared.dispose(), prepared.dispose()])
  expect(ctx.agents.get(request.sessionId)).toBeUndefined()
  await expect(prepared.execute(prompt())).rejects.toThrow('disposed before execute')
})

it('binds an explicitly requested preset before execution', async () => {
  const { ctx, adapter } = await setup([textResponse('preset complete')], true)
  await declare(ctx, contribution('standard'))
  const prepared = await prepareBuiltinAgent(ctx, declaration, { ...request, agentPreset: 'standard' })
  expect(prepared.session.header.agentPreset).toBe('standard')
  await prepared.execute(prompt())
  expect(adapter.requests[0]?.tools?.some(tool => tool.name === 'standard')).toBe(true)
  await prepared.dispose()
})

it('rejects unsupported declarations before creating an Agent', async () => {
  const { ctx } = await setup([])
  const declarations = [
    { ...declaration, enabled: false },
    { ...declaration, driver: 'zcode' },
    { ...declaration, compatibility: { protocolVersion: 2 } },
    { ...declaration, compatibility: { protocolVersion: 1, minCetusPrismVersion: '1.7.0' } },
  ]
  for (const candidate of declarations) {
    expect(() => resolveBuiltinAgent(candidate)).toThrow()
    await expect(prepareBuiltinAgent(ctx, candidate, request)).rejects.toThrow()
    expect(ctx.agents.get(request.sessionId)).toBeUndefined()
  }
})

it('rejects pre-aborted creation and a requested preset without a registry', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await expect(prepareBuiltinAgent(ctx, declaration, { ...request, signal: AbortSignal.abort() }))
    .rejects.toThrow('aborted before creation')
  await expect(prepareBuiltinAgent(ctx, declaration, { ...request, agentPreset: 'missing' }))
    .rejects.toThrow('no preset registry')
})

it('unwinds an unpublished Agent when preset binding fails', async () => {
  const { ctx } = await setup([], true)
  await expect(prepareBuiltinAgent(ctx, declaration, { ...request, agentPreset: 'missing' }))
    .rejects.toThrow('Unknown agent preset')
  expect(ctx.agents.get(request.sessionId)).toBeUndefined()
})

it.each(['cancel', 'dispose'] as const)('drains an active request on %s and retains the cancellation ending', async (action) => {
  const { ctx, adapter } = await setup(['hang'])
  const prepared = await prepareBuiltinAgent(ctx, declaration, request)
  const execution = prepared.execute(prompt())
  await vi.waitFor(() => expect(adapter.requests).toHaveLength(1))
  if (action === 'cancel') prepared.cancel({ kind: 'user' })
  else await prepared.dispose()
  const result = await execution
  expect(result.turnEnds).toEqual([expect.objectContaining({ reason: {
    kind: 'aborted', reason: { kind: action === 'cancel' ? 'user' : 'disposed' },
  } })])
  await prepared.whenIdle()
  await prepared.dispose()
  expect(ctx.agents.get(request.sessionId)).toBeUndefined()
})

it('reports provider failures rather than treating idleness as successful completion', async () => {
  const { ctx } = await setup([])
  const prepared = await prepareBuiltinAgent(ctx, declaration, request)
  const result = await prepared.execute(prompt())
  expect(result.failures).toHaveLength(1)
  expect(result.turnEnds[0]?.reason.kind).toBe('error')
  await prepared.dispose()
})
