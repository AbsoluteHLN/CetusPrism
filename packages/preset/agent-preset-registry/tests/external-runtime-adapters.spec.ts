/**
 * The external-runtime adapters, driven against fake stdio runtimes.
 *
 * Both fake runtimes are real child processes speaking the protocol each
 * upstream documents — Pi's command envelope (rpc.md, json.md) and ZCode's
 * normalized NDJSON frames (zcode-protocol schema) — so framing, request
 * correlation, event normalization and lifecycle are exercised over real
 * pipes without either upstream installed.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ExternalRuntimeEvent } from '../src/external-runtime.ts'
import { PiRuntimeAdapter } from '../src/external-runtime-pi.ts'
import { ZCodeRuntimeAdapter } from '../src/external-runtime-zcode.ts'

/**
 * A fake ZCode runtime that announces readiness and then never answers: the
 * outstanding-request lifecycle test needs one request that stays pending.
 */
const ZCODE_SILENT_SCRIPT = `
const send = (record) => process.stdout.write(JSON.stringify(record) + '\\n');
send({ method: 'startup/storageState', params: { ready: true } });
process.stdin.resume();
process.stdin.on('data', () => {});
`

/** A fake Pi RPC runtime: answers get_state, plays scripted events per prompt. */
const PI_SCRIPT = `
let buffer = '';
const send = (record) => process.stdout.write(JSON.stringify(record) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.type === 'get_state') {
      send({ id: record.id, type: 'response', command: 'get_state', success: true, data: { id: 'session-1' } });
    } else if (record.type === 'prompt') {
      const events = [
        { type: 'agent_start' },
        { type: 'message_update', usage: {}, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' } },
        { type: 'message_update', usage: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' } },
        { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } },
        { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: { text: 'ok' }, isError: false },
        { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: '529 overloaded' },
        { type: 'agent_settled', aborted: false },
      ];
      for (const event of events) send(event);
      send({ id: record.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    } else if (record.type === 'fail') {
      send({ id: record.id, type: 'response', command: 'fail', success: false, error: 'nope' });
    } else if (record.id !== undefined) {
      send({ id: record.id, type: 'response', command: record.type, success: true, data: {} });
    }
  }
});
`

/** A fake Pi runtime that starts a run but never settles: abort must win. */
const PI_HANG_SCRIPT = `
let buffer = '';
const send = (record) => process.stdout.write(JSON.stringify(record) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.type === 'get_state') {
      send({ id: record.id, type: 'response', command: 'get_state', success: true, data: { id: 'session-1' } });
    } else if (record.type === 'prompt') {
      send({ type: 'agent_start' });
      send({ id: record.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    } else if (record.id !== undefined) {
      send({ id: record.id, type: 'response', command: record.type, success: true, data: {} });
    }
  }
});
`

/** A fake ZCode runtime: startup notification, normalized request envelopes, scripted notifications. */
const ZCODE_SCRIPT = `
let buffer = '';
const send = (record) => process.stdout.write(JSON.stringify(record) + '\\n');
send({ method: 'startup/storageState', params: { ready: true } });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.method === 'session/create') {
      send({ id: frame.id, result: { sessionId: 'session-1', stateRevision: 1 } });
    } else if (frame.method === 'session/send') {
      const notifications = [
        { method: 'turn.started', params: { turnNumber: 1 } },
        { method: 'model.streaming', params: { kind: 'text_delta', delta: 'Hi', assistantMessageId: 'm1', partId: 'p1' } },
        { method: 'tool.updated', params: { kind: 'started', toolCallId: 't1', toolName: 'bash', input: { command: 'ls' } } },
        { method: 'tool.updated', params: { kind: 'result', toolCallId: 't1', toolName: 'bash', result: { text: 'ok' }, duration: 5 } },
        { method: 'state.updated', params: { type: 'state.updated', scope: 'session', sessionId: 'session-1', revision: 3, patch: { model: { provider: 'zai', modelId: 'glm-5' } } } },
        { method: 'turn.completed', params: { resultType: 'success', tokenCount: 10 } },
      ];
      for (const notification of notifications) send(notification);
      send({ id: frame.id, result: { sessionId: 'session-1', accepted: true, stateRevision: 2 } });
    } else if (frame.method === 'session/stop') {
      send({ id: frame.id, error: { code: -32004, message: 'session unavailable' } });
    } else if (frame.method === 'noop') {
      // A server-to-client request the host must answer or decline.
      send({ id: 'srv-1', method: 'interaction/requestPermission', params: { toolName: 'bash' } });
      send({ id: frame.id, result: {} });
    }
  }
});
`

function fakeRuntime(script: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ['-e', script] }
}

async function collect(adapter: { subscribe(listener: (event: ExternalRuntimeEvent) => void): () => void }, run: () => Promise<void>): Promise<ExternalRuntimeEvent[]> {
  const events: ExternalRuntimeEvent[] = []
  const unsubscribe = adapter.subscribe(event => { events.push(event) })
  try {
    await run()
  } finally {
    unsubscribe()
  }
  return events
}

describe('PiRuntimeAdapter', () => {
  it('starts, correlates commands and normalizes the documented events', async () => {
    const adapter = new PiRuntimeAdapter(fakeRuntime(PI_SCRIPT))
    try {
      await adapter.start()
      const events = await collect(adapter, async () => {
        await expect(adapter.request('prompt', { message: 'Hello' })).resolves.toEqual({ disposition: 'started' })
      })
      expect(events).toEqual([
        { type: 'run_started' },
        { type: 'message_delta', delta: 'hmm', kind: 'thinking' },
        { type: 'message_delta', delta: 'Hello', kind: 'text' },
        { type: 'tool_started', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } },
        { type: 'tool_finished', toolCallId: 'c1', toolName: 'bash', result: { text: 'ok' }, isError: false },
        { type: 'notice', level: 'warn', message: 'Pi auto-retry 1/3 in 2000ms: 529 overloaded' },
        { type: 'idle', aborted: false },
      ])
    } finally {
      await adapter.stop()
    }
  })

  it('rejects a failed command with the runtime error', async () => {
    const adapter = new PiRuntimeAdapter(fakeRuntime(PI_SCRIPT))
    try {
      await adapter.start()
      await expect(adapter.request('fail')).rejects.toThrow('Pi command failed: nope')
    } finally {
      await adapter.stop()
    }
  })

  it('declares the capabilities the rpc mode documents', () => {
    const adapter = new PiRuntimeAdapter()
    expect(adapter.capabilities()).toEqual({
      streaming: true, steering: true, followUp: true, hostPermission: false, hostUserInput: false, hostSideToolExecution: false,
    })
  })

  it('runTurn prompts and resolves when the runtime settles', async () => {
    const adapter = new PiRuntimeAdapter(fakeRuntime(PI_SCRIPT))
    try {
      await adapter.start()
      await expect(adapter.runTurn('do it', new AbortController().signal)).resolves.toBeUndefined()
    } finally {
      await adapter.stop()
    }
  })

  it('runTurn rejects with the signal reason when aborted mid-run', async () => {
    // A runtime that starts a run but never settles: abort must win.
    const adapter = new PiRuntimeAdapter(fakeRuntime(PI_HANG_SCRIPT))
    try {
      await adapter.start()
      const controller = new AbortController()
      const pending = adapter.runTurn('hang', controller.signal)
      const settled = expect(pending).rejects.toThrow('stop this')
      controller.abort(new Error('stop this'))
      await settled
    } finally {
      await adapter.stop()
    }
  })

  it('abortTurn sends the documented interrupt command', async () => {
    const adapter = new PiRuntimeAdapter(fakeRuntime(PI_SCRIPT))
    try {
      await adapter.start()
      await expect(adapter.abortTurn()).resolves.toBeUndefined()
    } finally {
      await adapter.stop()
    }
  })
})

describe('ZCodeRuntimeAdapter', () => {
  it('starts on the startup frame, correlates requests and normalizes notifications', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SCRIPT))
    try {
      await adapter.start()
      const events = await collect(adapter, async () => {
        await expect(adapter.request('session/create', { workspace: { root: '/tmp' } }))
          .resolves.toEqual({ sessionId: 'session-1', stateRevision: 1 })
        await expect(adapter.request('session/send', { sessionId: 'session-1', content: 'Hello' }))
          .resolves.toEqual({ sessionId: 'session-1', accepted: true, stateRevision: 2 })
      })
      // Notifications may trail their request's response across stream chunks.
      await vi.waitFor(() => {
        expect(events).toEqual([
          { type: 'run_started' },
          { type: 'message_delta', delta: 'Hi', kind: 'text' },
          { type: 'tool_started', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
          { type: 'tool_finished', toolCallId: 't1', toolName: 'bash', result: { text: 'ok' }, isError: false },
          { type: 'state_changed', model: { provider: 'zai', modelId: 'glm-5' } },
          { type: 'idle', aborted: false },
        ])
      })
    } finally {
      await adapter.stop()
    }
  })

  it('rejects a protocol error frame with its code and message', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SCRIPT))
    try {
      await adapter.start()
      await expect(adapter.request('session/stop', { sessionId: 'session-1' }))
        .rejects.toThrow(/-32004.*session unavailable/)
    } finally {
      await adapter.stop()
    }
  })

  it('declines server-to-client interaction requests it cannot serve', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SCRIPT))
    try {
      await adapter.start()
      const events = await collect(adapter, async () => {
        // The fake answers this request AND forwards a server-to-client
        // interaction request, exactly the shape the protocol documents.
        await adapter.request('noop')
      })
      await vi.waitFor(() => {
        expect(events).toContainEqual({ type: 'notice', level: 'warn', message: 'ZCode requested interaction/requestPermission; the host has no interaction surface yet and declined' })
      })
    } finally {
      await adapter.stop()
    }
  })

  it('declares the capabilities the stdio server documents', () => {
    const adapter = new ZCodeRuntimeAdapter()
    expect(adapter.capabilities()).toEqual({
      streaming: true, steering: true, followUp: true, hostPermission: true, hostUserInput: true, hostSideToolExecution: false,
    })
  })

  it('runTurn creates the session once, sends and settles on turn.completed', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SCRIPT))
    try {
      await adapter.start()
      await expect(adapter.runTurn('Hello', new AbortController().signal)).resolves.toBeUndefined()
      // A second turn reuses the lazily created protocol session.
      await expect(adapter.runTurn('Again', new AbortController().signal)).resolves.toBeUndefined()
    } finally {
      await adapter.stop()
    }
  })

  it('runTurn rejects with the signal reason when aborted before the session exists', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SCRIPT))
    try {
      await adapter.start()
      const controller = new AbortController()
      controller.abort(new Error('never mind'))
      await expect(adapter.runTurn('late', controller.signal)).rejects.toThrow('never mind')
    } finally {
      await adapter.stop()
    }
  })

  it('abortTurn is a no-op before any session exists and surfaces protocol refusals after', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SCRIPT))
    try {
      await adapter.start()
      // No turn has run, so no protocol session exists: nothing to stop.
      await expect(adapter.abortTurn()).resolves.toBeUndefined()
      await adapter.runTurn('make a session', new AbortController().signal)
      // The fake server refuses session/stop for every session id.
      await expect(adapter.abortTurn()).rejects.toThrow(/-32004/)
    } finally {
      await adapter.stop()
    }
  })

  it('settles outstanding requests when the runtime is stopped', async () => {
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_SILENT_SCRIPT))
    try {
      await adapter.start()
      const pending = adapter.request('session/send', { sessionId: 's1' })
      // Attach the rejection handler before stop: stop settles the request
      // synchronously, and an unobserved rejection would surface as an
      // unhandled error.
      const settled = expect(pending).rejects.toThrow('ZCode runtime stopped')
      await adapter.stop()
      await settled
    } finally {
      await adapter.stop()
    }
  })

  it('rejects start when the runtime command cannot be spawned', async () => {
    const adapter = new PiRuntimeAdapter({ command: 'dsh-definitely-not-a-runtime' })
    await expect(adapter.start()).rejects.toThrow()
    await adapter.stop()
  })
})

describe('request timeout', () => {
  it('rejects a request the runtime never answers', async () => {
    const adapter = new ZCodeRuntimeAdapter({
      ...fakeRuntime(ZCODE_SILENT_SCRIPT),
      requestTimeoutMs: 40,
    })
    try {
      await adapter.start()
      const result = adapter.request('session/send', { sessionId: 's1' })
      const settled = expect(result).rejects.toThrow(/did not answer within 40ms/)
      await settled
    } finally {
      await adapter.stop()
    }
  })
})
