import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

/** The script a mock endpoint replays, one answer per request. */
type MockScript = Parameters<typeof mockServer>[0]

/** The levels pi-ai's word list holds, in the order the probe asks about them. */
const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * One scripted answer per level, in the order the probe asks.
 * @param answer - decides the answer for one level.
 * @returns the endpoint's script.
 */
function effortScript(answer: (level: string) => { status: number; body?: string }): MockScript {
  return LEVELS.map(level => answer(level))
}

/** A refusal body that names the levels the endpoint takes. */
function refusesWith(message: string): { status: number; body: string } {
  return { status: 400, body: JSON.stringify({ error: { message } }) }
}

/** A bare dormant mount: the probe is offered whether or not a route exists. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {})
  return ctx
}

describe('host reasoning-effort probe', () => {
  it('answers with the levels the endpoint takes and the ones it refuses', async () => {
    const server = await mockServer(effortScript(level => (
      level === 'low' || level === 'medium' ? { status: 200 } : refusesWith('reasoning_effort must be low, medium')
    )))
    const ctx = await harness()

    const result = await ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      baseURL: server.url,
      model: 'qwen3-max',
    })

    expect(result.accepted).toEqual(['low', 'medium'])
    expect(result.refused.map(entry => entry.level)).toEqual(['minimal', 'high', 'xhigh', 'max'])
    expect(result.refused[0]?.detail).toContain('reasoning_effort must be low, medium')
    expect(result.declared).toEqual(['low', 'medium'])
    expect(result.declaration).toEqual({ off: null, low: 'low', medium: 'medium' })
    // One request per level, on the chat-completions path, and never more.
    expect(server.paths).toEqual(Array.from({ length: 6 }, () => '/chat/completions'))
  })

  it('is offered for the namespace, and withdrawn when the plugin unloads', async () => {
    const server = await mockServer(effortScript(() => ({ status: 200 })))
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmPiAi, {})

    await expect(ctx.llm.probeReasoningEfforts('llm-pi-ai', { baseURL: server.url, model: 'qwen3-max' }))
      .resolves.toMatchObject({ accepted: LEVELS })
    await expect(ctx.llm.probeReasoningEfforts('llm-deepseek', { baseURL: server.url, model: 'qwen3-max' }))
      .rejects.toMatchObject({ code: 'NO_PROBE' })

    await fiber.dispose()

    await expect(ctx.llm.probeReasoningEfforts('llm-pi-ai', { baseURL: server.url, model: 'qwen3-max' }))
      .rejects.toMatchObject({ code: 'NO_PROBE' })
  })

  it('reports an endpoint that fails every level as a probe failure', async () => {
    const server = await mockServer(effortScript(() => ({
      status: 401,
      body: '{"error":{"message":"invalid api key"}}',
    })))
    const ctx = await harness()

    const failure = await ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      baseURL: server.url,
      model: 'qwen3-max',
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toMatchObject({ code: 'EFFORT_PROBE_FAILED' })
    expect(String((failure as Error).message)).toMatch(/check the API key/)
  })

  it('never puts the credential in the request or in the failure', async () => {
    const server = await mockServer(effortScript(() => ({
      status: 401,
      body: '{"error":{"message":"invalid api key"}}',
    })))
    const ctx = await harness()

    const failure = await ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      baseURL: server.url,
      model: 'qwen3-max',
      apiKey: 'super-secret-key',
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toMatchObject({ code: 'EFFORT_PROBE_FAILED' })
    expect(String((failure as Error).message)).not.toContain('super-secret-key')
    // The credential travels in the header it belongs in, and nowhere else.
    expect(JSON.stringify(server.requests)).not.toContain('super-secret-key')
    expect(server.headers[0]?.authorization).toBe('Bearer super-secret-key')
  })

  it('authenticates a configured route the draft cannot supply a key for', async () => {
    vi.stubEnv('ACME_GATEWAY_KEY', 'stored-key')
    const server = await mockServer(effortScript(() => ({ status: 200 })))
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'ACME_GATEWAY_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'acme-large' }],
        },
      },
    })

    await ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      model: 'acme-large',
    })

    expect(server.headers[0]?.authorization).toBe('Bearer stored-key')
  })

  it('carries a configured route\'s deployment headers into every probe request', async () => {
    const server = await mockServer(effortScript(() => ({ status: 200 })))
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          api: 'openai-completions',
          baseURL: server.url,
          headers: { 'x-company-code': 'acme-42' },
          models: [{ id: 'acme-large' }],
        },
      },
    })

    await ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      model: 'acme-large',
    })

    // A gateway that authenticates through its own header is interrogated the
    // same way it is called.
    expect(server.headers[0]?.['x-company-code']).toBe('acme-42')
  })

  it('leaves a route the Host does not hold unauthenticated', async () => {
    const server = await mockServer(effortScript(() => ({ status: 200 })))
    const ctx = await harness()

    await ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      provider: 'not-declared-yet',
      baseURL: server.url,
      model: 'acme-large',
    })

    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('says the protocol has no probeable levels, without asking the endpoint', async () => {
    const server = await mockServer(effortScript(() => ({ status: 200 })))
    const ctx = await harness()

    await expect(ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      baseURL: server.url,
      api: 'openai-responses',
      model: 'qwen3-max',
    })).rejects.toMatchObject({ code: 'EFFORT_PROBE_UNSUPPORTED' })
    expect(server.requests).toHaveLength(0)
  })

  it('says the endpoint is needed when the draft names none', async () => {
    const ctx = await harness()

    await expect(ctx.llm.probeReasoningEfforts('llm-pi-ai', { model: 'qwen3-max' }))
      .rejects.toMatchObject({ code: 'EFFORT_PROBE_FAILED' })
  })

  it('honors caller cancellation', async () => {
    const server = await mockServer(effortScript(() => ({ status: 200 })))
    const ctx = await harness()

    await expect(ctx.llm.probeReasoningEfforts('llm-pi-ai', {
      baseURL: server.url,
      model: 'qwen3-max',
    }, AbortSignal.abort('test cancellation'))).rejects.toMatchObject({ code: 'ABORTED' })
    expect(server.requests).toHaveLength(0)
  })
})
