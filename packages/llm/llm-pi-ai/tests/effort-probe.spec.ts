import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { probeReasoningEfforts } from '../src/effort-probe.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** What the stand-in endpoint answers one request with. */
interface EffortReply {
  /** The HTTP status to answer with. */
  status: number
  /** The body to answer with; a minimal completion when absent. */
  body?: string
  /** How long the answer is held back, so a cancellation can land mid-request. */
  delayMs?: number
}

/** What the stand-in endpoint saw. */
interface EffortServer {
  url: string
  paths: string[]
  bodies: Record<string, unknown>[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in endpoint that answers each effort level from a script.
 *
 * The level is read from the request body, so the endpoint judges exactly what
 * the probe put on the wire.
 * @param reply - decides the answer for one level.
 * @param onRequest - called once per request, before the answer is sent.
 * @returns the endpoint and what it saw.
 */
async function effortServer(
  reply: (level: string) => EffortReply,
  onRequest?: () => void,
): Promise<EffortServer> {
  const paths: string[] = []
  const bodies: Record<string, unknown>[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      paths.push(request.url ?? '')
      headers.push(request.headers)
      const body = raw.length === 0 ? {} : JSON.parse(raw) as Record<string, unknown>
      bodies.push(body)
      onRequest?.()
      const answer = reply(typeof body['reasoning_effort'] === 'string' ? body['reasoning_effort'] : '')
      const payload = answer.body ?? '{"choices":[]}'
      const send = (): void => {
        response.writeHead(answer.status, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        })
        response.end(payload)
      }
      if (answer.delayMs === undefined) send()
      else setTimeout(send, answer.delayMs)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, bodies, headers }
}

/** A refusal body that names the levels the endpoint takes. */
function refusesWith(message: string): EffortReply {
  return { status: 400, body: JSON.stringify({ error: { message } }) }
}

describe('reasoning-effort probe', () => {
  it('separates the levels the endpoint takes from the ones it refuses', async () => {
    const server = await effortServer(level => (level === 'low' || level === 'medium')
      ? { status: 200 }
      : refusesWith('reasoning_effort must be low, medium'))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low', 'medium', 'high'],
    })

    expect(result.accepted).toEqual(['low', 'medium'])
    expect(result.refused.map(entry => entry.level)).toEqual(['high'])
    expect(result.refused[0]?.detail).toContain('reasoning_effort must be low, medium')
    expect(result.declaration).toEqual({ off: null, low: 'low', medium: 'medium' })
  })

  it('reads the level set the endpoint enumerates for itself', async () => {
    // The production gateway answers a refused level with the levels it takes,
    // in a sentence whose polarity is loose.
    const server = await effortServer(level => (level === 'low' || level === 'medium' || level === 'xhigh')
      ? { status: 200 }
      : refusesWith('Unsupported types are xhigh (default), medium, and low'))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low', 'medium', 'high', 'xhigh', 'max'],
    })

    expect(result.declared).toEqual(['low', 'medium', 'xhigh'])
    expect(result.accepted).toEqual(['low', 'medium', 'xhigh'])
    expect(result.refused.map(entry => entry.level)).toEqual(['high', 'max'])
    expect(result.declaration).toEqual({ off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' })
  })

  it('reads a level set the endpoint reports as data', async () => {
    const server = await effortServer(level => (level === 'low' || level === 'medium')
      ? { status: 200 }
      : { status: 400, body: JSON.stringify({ error: { message: 'unsupported effort', supported: ['low', 'medium'] } }) })

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low', 'medium', 'high'],
    })

    expect(result.declared).toEqual(['low', 'medium'])
    expect(result.accepted).toEqual(['low', 'medium'])
    expect(result.refused.map(entry => entry.level)).toEqual(['high'])
  })

  it('trusts the measurement over the endpoint\'s own enumeration', async () => {
    // The endpoint accepts a level its enumeration omits, and refuses one its
    // enumeration lists. The measurement settles both, and says so.
    const server = await effortServer(level => (level === 'high')
      ? { status: 200 }
      : refusesWith('Unsupported types are xhigh (default), medium, and low'))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low', 'high'],
    })

    expect(result.accepted).toEqual(['medium', 'high', 'xhigh'])
    expect(result.refused.map(entry => entry.level)).toEqual(['low'])
    expect(result.outcomes.find(outcome => outcome.level === 'high')?.detail)
      .toMatch(/accepted "high", which its own enumeration omits/)
    expect(result.outcomes.find(outcome => outcome.level === 'low')?.detail)
      .toMatch(/lists "low", yet it refused it/)
  })

  it('never asks about off: not thinking is the absence of the parameter', async () => {
    const server = await effortServer(() => ({ status: 200 }))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['off', 'low', 'medium'],
    })

    expect(server.bodies).toHaveLength(2)
    expect(server.bodies.map(body => body['reasoning_effort'])).toEqual(['low', 'medium'])
    expect(result.declaration).toEqual({ off: null, low: 'low', medium: 'medium' })
    expect(result.accepted).not.toContain('off')
  })

  it('asks about each level exactly once, with the smallest request', async () => {
    const server = await effortServer(() => ({ status: 200 }))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      apiKey: 'probe-key',
    })

    expect(server.bodies).toHaveLength(6)
    expect(server.bodies.map(body => body['reasoning_effort']))
      .toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(server.paths).toEqual(Array.from({ length: 6 }, () => '/chat/completions'))
    expect(server.bodies[0]).toEqual({
      model: 'qwen3-max',
      messages: [{ role: 'user', content: 'ping' }],
      reasoning_effort: 'minimal',
      max_tokens: 8,
    })
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(result.accepted).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('accepts a level whose reply is a 2xx carrying an error document', async () => {
    const server = await effortServer(() => ({ status: 200, body: '{"error":{"message":"not really"}}' }))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low'],
    })

    expect(result.accepted).toEqual(['low'])
    expect(result.refused).toEqual([])
    expect(result.outcomes[0]?.accepted).toBe(true)
  })

  it('reports a credential failure as a fault, not as a refused level', async () => {
    const server = await effortServer(() => ({ status: 401, body: '{"error":{"message":"invalid api key"}}' }))

    const failure = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      apiKey: 'wrong-key',
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toMatchObject({ code: 'EFFORT_PROBE_FAILED' })
    expect((failure as Error).message).toMatch(/check the API key/)
    expect((failure as Error).message).toMatch(/not a reasoning-effort problem/)
  })

  it('records a fault beside the levels it could still judge', async () => {
    const server = await effortServer(level => (level === 'low' ? { status: 200 } : { status: 500, body: 'boom' }))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low', 'high'],
    })

    expect(result.accepted).toEqual(['low'])
    expect(result.fault).toMatchObject({ code: 'EFFORT_PROBE_FAILED', status: 500 })
    expect(result.refused[0]?.detail).toMatch(/not a reasoning-effort problem/)
  })

  it('reports an endpoint it cannot reach', async () => {
    // Port 9 is the discard service: nothing accepts a connection there.
    await expect(probeReasoningEfforts({ baseURL: 'http://127.0.0.1:9/v1', model: 'qwen3-max' }))
      .rejects.toMatchObject({ code: 'EFFORT_PROBE_FAILED' })
  })

  it('reports a malformed credential as a credential fault', async () => {
    await expect(probeReasoningEfforts({
      baseURL: 'http://127.0.0.1:9/v1',
      model: 'qwen3-max',
      apiKey: 'sk-\u{1F600}',
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('never names the credential', async () => {
    const server = await effortServer(() => ({ status: 401, body: '{"error":{"message":"nope"}}' }))

    const failure = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      apiKey: 'super-secret-key',
    }).then(() => undefined, (error: unknown) => error)

    expect(String((failure as Error).message)).not.toContain('super-secret-key')
  })

  it('ends the probe as aborted when the caller cancels', async () => {
    const server = await effortServer(() => ({ status: 200 }))
    const controller = new AbortController()
    controller.abort('test cancellation')

    await expect(probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'ABORTED' })
    expect(server.bodies).toHaveLength(0)
  })

  it('stops when the caller cancels while a request is in flight', async () => {
    const controller = new AbortController()
    const received = Promise.withResolvers<void>()
    const server = await effortServer(() => ({ status: 200, delayMs: 500 }), () => received.resolve(undefined))

    const probe = probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      signal: controller.signal,
    })
    await received.promise
    controller.abort('test cancellation')

    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('says the protocol has no probeable levels, without asking the endpoint', async () => {
    const server = await effortServer(() => ({ status: 200 }))

    for (const api of ['openai-responses', 'anthropic-messages', 'bedrock-converse-stream']) {
      await expect(probeReasoningEfforts({ baseURL: server.url, api, model: 'qwen3-max' }))
        .rejects.toMatchObject({ code: 'EFFORT_PROBE_UNSUPPORTED' })
    }
    expect(server.bodies).toHaveLength(0)
  })

  it('keeps a runaway refusal body bounded', async () => {
    const server = await effortServer(() => ({
      status: 400,
      body: `reasoning_effort is not accepted by this endpoint ${'x'.repeat(200_000)}`,
    }))

    const result = await probeReasoningEfforts({
      baseURL: server.url,
      model: 'qwen3-max',
      candidates: ['low'],
    })

    expect(result.refused[0]?.detail.length).toBeLessThan(500)
  })
})
