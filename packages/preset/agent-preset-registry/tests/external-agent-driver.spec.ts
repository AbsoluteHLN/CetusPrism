/**
 * The external-runtime agent driver, exercised through the real agent-loop
 * factory seam: a scripted fake adapter stands in for Pi/ZCode so the durable
 * session vocabulary, inbox semantics, abort mapping and adapter lifecycle
 * are verified end to end without an installed runtime.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmError, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ExternalRuntimeAdapter, ExternalRuntimeCapabilities, ExternalRuntimeEvent, ExternalRuntimeId } from '../src/external-runtime.ts'
import { abortedCancelCause, extractText, ExternalAgentDriver, stringifyResult } from '../src/external-agent-driver.ts'

type Emit = (event: ExternalRuntimeEvent) => void
type Script = (input: string, emit: Emit, signal: AbortSignal) => Promise<void>

/** A scripted fake adapter: the test scripts what each turn emits. */
class FakeAdapter implements ExternalRuntimeAdapter {
  readonly runtimeId = 'pi' as ExternalRuntimeId
  readonly runtimeVersion = '0.0.0-test'
  started = false
  stopped = false
  turns: string[] = []
  aborts = 0
  private readonly listeners = new Set<(event: ExternalRuntimeEvent) => void>()
  constructor(private readonly script: Script) {}

  capabilities(): ExternalRuntimeCapabilities {
    return { streaming: true, steering: true, followUp: true, hostPermission: false, hostUserInput: false, hostSideToolExecution: false }
  }

  async start(): Promise<void> { this.started = true }
  async stop(): Promise<void> { this.stopped = true }
  async request(): Promise<unknown> { return {} }
  subscribe(listener: (event: ExternalRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(event: ExternalRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  async runTurn(input: string, signal: AbortSignal): Promise<void> {
    this.turns.push(input)
    await this.script(input, event => this.emit(event), signal)
    signal.throwIfAborted()
  }

  async abortTurn(): Promise<void> { this.aborts += 1 }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

async function createExternalAgent(ctx: Context, sessionId: string, adapter: FakeAdapter): Promise<{ agent: Agent; dispose: () => Promise<void> }> {
  const handle = await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'pi', model: 'fake-model' },
    driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
  })
  return { agent: handle.agent, dispose: () => handle.dispose() }
}

function prompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** The turn script most tests use: thinking + text + one tool call + model state. */
const RICH_SCRIPT: Script = async (_input, emit) => {
  emit({ type: 'run_started' })
  emit({ type: 'message_delta', delta: 'hmm', kind: 'thinking' })
  emit({ type: 'message_delta', delta: 'done', kind: 'text' })
  emit({ type: 'tool_started', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } })
  emit({ type: 'tool_finished', toolCallId: 'c1', toolName: 'bash', result: { ok: true }, isError: false })
  emit({ type: 'state_changed', model: { provider: 'fake', modelId: 'fake-model' } })
  emit({ type: 'idle', aborted: false })
}

describe('ExternalAgentDriver', () => {
  it('drives a turn through the seam and writes the durable loop vocabulary', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(RICH_SCRIPT)
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-rich', adapter)
    try {
      prompt(agent, 'hello runtime')
      await agent.whenIdle()

      expect(adapter.turns).toEqual(['hello runtime'])
      const events = agent.session.snapshotEvents()
      expect(events.map(event => event.type)).toEqual([
        'agent/inbox/spliced',
        'turn/start',
        // The claim that moves the prompt out of the inbox is durable too.
        'agent/inbox/spliced',
        'step/start',
        'user/message',
        'tool/call',
        'tool/result',
        'request/context',
        'assistant/message',
        'step/end',
        'turn/end',
      ])
      const turnEnd = events.at(-1)
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'completed' })

      const assistant = events.find(event => event.type === 'assistant/message')
      if (assistant?.type !== 'assistant/message') throw new Error('expected an assistant/message')
      expect(assistant.data.message.content).toEqual([
        { type: 'reasoning', text: 'hmm' },
        { type: 'text', text: 'done' },
      ])
      expect(assistant.data.message.source).toMatchObject({ provider: 'pi', model: 'fake-model' })
      expect(assistant.data.stream.length).toBeGreaterThan(0)

      const call = events.find(event => event.type === 'tool/call')
      const result = events.find(event => event.type === 'tool/result')
      if (call?.type !== 'tool/call' || result?.type !== 'tool/result') throw new Error('expected a tool call pair')
      expect(call.data).toMatchObject({ turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) })
      expect(result.sourceEventSeqs).toEqual([call.seq])
      expect(result.data.message.isError).toBe(false)
    } finally {
      await dispose()
    }
  })

  it('runs each queued follow-up as its own step inside the draining turn', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(RICH_SCRIPT)
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-turns', adapter)
    try {
      prompt(agent, 'first')
      prompt(agent, 'second')
      await agent.whenIdle()

      // Both prompts ran; like the React loop, a follow-up queued while the
      // driver drains joins the open turn as another step, not a new turn.
      expect(adapter.turns).toEqual(['first', 'second'])
      const events = agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
      expect(events.filter(event => event.type === 'step/start')).toHaveLength(2)
      const steps = events.filter(event => event.type === 'step/start')
      expect(steps.map(event => event.type === 'step/start' && event.data.step)).toEqual([1, 2])
    } finally {
      await dispose()
    }
  })

  it('advances one step per model round when the runtime reports round boundaries', async () => {
    const ctx = await harness()
    // Pi-style: two message rounds inside one run — a tool loop's second
    // model answer arrives after a message_started boundary.
    const adapter = new FakeAdapter(async (_input, emit) => {
      emit({ type: 'run_started' })
      emit({ type: 'message_started', message: { role: 'assistant' } })
      emit({ type: 'message_delta', delta: 'let me look', kind: 'text' })
      emit({ type: 'tool_started', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } })
      emit({ type: 'tool_finished', toolCallId: 'c1', toolName: 'bash', result: 'file.txt', isError: false })
      emit({ type: 'message_finished', message: { role: 'assistant' } })
      emit({ type: 'message_started', message: { role: 'assistant' } })
      emit({ type: 'message_delta', delta: 'found it', kind: 'text' })
      emit({ type: 'message_finished', message: { role: 'assistant' } })
      emit({ type: 'idle', aborted: false })
    })
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-rounds', adapter)
    try {
      prompt(agent, 'inspect')
      await agent.whenIdle()

      const events = agent.session.snapshotEvents()
      // One turn, two steps (one per round), each with its own settlement.
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(events.filter(event => event.type === 'step/start')).toHaveLength(2)
      expect(events.filter(event => event.type === 'step/end')).toHaveLength(2)
      const assistants = events.filter(event => event.type === 'assistant/message')
      expect(assistants).toHaveLength(2)
      expect(assistants[0]?.type === 'assistant/message' && assistants[0].data.message.content)
        .toEqual([{ type: 'text', text: 'let me look' }])
      expect(assistants[1]?.type === 'assistant/message' && assistants[1].data.message.content)
        .toEqual([{ type: 'text', text: 'found it' }])
      // The tool call belongs to the round (step 1) it executed in.
      const call = events.find(event => event.type === 'tool/call')
      expect(call?.type === 'tool/call' && call.data.step).toBe(1)
      const steps = events.filter(event => event.type === 'step/start')
      expect(steps.map(event => event.type === 'step/start' && event.data.step)).toEqual([1, 2])
    } finally {
      await dispose()
    }
  })

  it('maps cancel to an aborted turn end and asks the runtime to interrupt', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, emit, signal) => {
      emit({ type: 'message_delta', delta: 'partial', kind: 'text' })
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
    })
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-abort', adapter)
    try {
      prompt(agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })
      agent.cancel({ kind: 'user' })
      await agent.whenIdle()

      expect(adapter.aborts).toBe(1)
      const events = agent.session.snapshotEvents()
      const interrupted = events.find(event => event.type === 'assistant/message')
      expect(interrupted?.type === 'assistant/message' && interrupted.data.interrupted).toBe(true)
      expect(interrupted?.type === 'assistant/message' && interrupted.data.message.content)
        .toEqual([{ type: 'text', text: 'partial' }])
      const turnEnd = events.at(-1)
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    } finally {
      await dispose()
    }
  })

  it('stages injected context without waking, then claims it ahead of the prompt', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(RICH_SCRIPT)
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-inject', adapter)
    try {
      agent.inject(createUserMessage({ content: [{ type: 'text', text: 'staged context' }], source: { kind: 'user' } }))
      expect(agent.status).toBe('idle')
      expect(adapter.turns).toEqual([])

      prompt(agent, 'run now')
      await agent.whenIdle()

      // Both messages ran, in claim order: steering context first.
      expect(adapter.turns).toEqual(['staged context', 'run now'])
      const userMessages = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
      expect(userMessages).toHaveLength(2)
      const steps = agent.session.snapshotEvents().filter(event => event.type === 'step/start')
      expect(steps).toHaveLength(2)
    } finally {
      await dispose()
    }
  })

  it('starts the adapter lazily on the first turn and stops it at disposal', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(RICH_SCRIPT)
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-lifecycle', adapter)
    try {
      expect(adapter.started).toBe(false)
      prompt(agent, 'wake')
      await agent.whenIdle()
      expect(adapter.started).toBe(true)
      expect(adapter.stopped).toBe(false)
    } finally {
      await dispose()
      expect(adapter.stopped).toBe(true)
    }
  })

  it('settles a failed run as an attempt without fabricating model-visible history', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, emit) => {
      emit({ type: 'message_delta', delta: 'half', kind: 'text' })
      emit({ type: 'notice', level: 'error', message: 'runtime exploded' })
      throw new Error('runtime exploded')
    })
    const { agent, dispose } = await createExternalAgent(ctx, 'ext-fail', adapter)
    try {
      prompt(agent, 'fail please')
      await agent.whenIdle()

      const events = agent.session.snapshotEvents()
      expect(events.some(event => event.type === 'assistant/message')).toBe(false)
      const attempt = events.find(event => event.type === 'assistant/attempt')
      expect(attempt?.type === 'assistant/attempt' && attempt.data.stream.length).toBeGreaterThan(0)
      const turnEnd = events.at(-1)
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({
        kind: 'error',
        error: { message: 'runtime exploded', code: 'UNKNOWN' },
      })
    } finally {
      await dispose()
    }
  })
})

describe('abortedCancelCause', () => {
  it('copies only the fields turn/end records for each known cause', () => {
    const aborted = (reason: unknown): AbortSignal => {
      const controller = new AbortController()
      controller.abort(reason)
      return controller.signal
    }
    expect(abortedCancelCause(aborted({ kind: 'user' }))).toEqual({ kind: 'user' })
    expect(abortedCancelCause(aborted({ kind: 'parent' }))).toEqual({ kind: 'parent' })
    expect(abortedCancelCause(aborted({ kind: 'disposed' }))).toEqual({ kind: 'disposed' })
    expect(abortedCancelCause(aborted({ kind: 'hook', reason: 'guard rejected' })))
      .toEqual({ kind: 'hook', reason: 'guard rejected' })
    // A non-cause reason (a plain abort or an arbitrary error) flattens to user.
    expect(abortedCancelCause(aborted(new Error('transport lost')))).toEqual({ kind: 'user' })
    expect(abortedCancelCause(aborted(undefined))).toEqual({ kind: 'user' })
  })

  it('reports undefined for a signal that never aborted', () => {
    expect(abortedCancelCause(new AbortController().signal)).toBeUndefined()
  })
})

describe('cancel and input edge paths', () => {
  it('keeps queued input across a keepInbox cancel and replays it', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (input, emit, signal) => {
      // Only the first turn hangs; the replayed queue must complete.
      if (input === 'hang') {
        await new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        return
      }
      emit({ type: 'idle', aborted: false })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('keep-inbox'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } }))
      handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
      await handle.agent.whenIdle()

      // The queue survived the cancel; it replays on the next wake.
      expect(adapter.turns).toEqual(['hang'])
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'wake' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      expect(adapter.turns).toEqual(['hang', 'queued', 'wake'])
    } finally {
      await handle.dispose()
    }
  })

  it('interrupts a running turn once and ignores a redundant cancel', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, _emit, signal) => {
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('double-cancel'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })
      // Back-to-back cancels while the phase is still running: the signal is
      // already aborted, so the runtime is asked to interrupt exactly once.
      handle.agent.cancel({ kind: 'user' })
      handle.agent.cancel({ kind: 'user' })
      await handle.agent.whenIdle()

      expect(adapter.aborts).toBe(1)
    } finally {
      await handle.dispose()
    }
  })

  it('treats a cancel while idle as a no-op', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, emit) => {
      emit({ type: 'idle', aborted: false })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('idle-cancel'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'quick')
      await handle.agent.whenIdle()
      handle.agent.cancel({ kind: 'user' })

      expect(adapter.aborts).toBe(0)
    } finally {
      await handle.dispose()
    }
  })

  it('rejects maintenance while the driver has active work', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, _emit, signal) => {
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('busy-maintenance'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })

      expect(() => handle.agent.runMaintenance(async () => 'never'))
        .toThrow(/already has active work/)
    } finally {
      await handle.dispose()
    }
  })
})

describe('input helpers', () => {
  it('extractText rejects a message without any text block', () => {
    expect(() => extractText(createUserMessage({ content: [{ type: 'reasoning', text: 'not user visible' }], source: { kind: 'user' } })))
      .toThrow(/text input only/)
  })

  it('stringifyResult falls back to String for values JSON cannot carry', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(stringifyResult(circular)).toBe('[object Object]')
    expect(stringifyResult('plain')).toBe('plain')
    expect(stringifyResult({ ok: 1 })).toBe('{"ok":1}')
  })
})

describe('wake latching and adapter failure tolerance', () => {
  it('replays a wake sent during an aborted activity as the next turn', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (input, emit, signal) => {
      if (input === 'hang') {
        await new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        return
      }
      emit({ type: 'idle', aborted: false })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('wake-after-abort'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })
      handle.agent.cancel({ kind: 'user' })
      // Sent while the aborted turn is still unwinding: the wake cannot join
      // it, so it opens the next turn.
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'after' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()

      expect(adapter.turns).toEqual(['hang', 'after'])
    } finally {
      await handle.dispose()
    }
  })

  it('swallows a failing abortTurn and stop without breaking disposal', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, _emit, signal) => {
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    adapter.abortTurn = async () => { throw new Error('channel gone') }
    adapter.stop = async () => { throw new Error('process already reaped') }
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('adapter-failures'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })
      handle.agent.cancel({ kind: 'user' })
      await handle.agent.whenIdle()
    } finally {
      // Neither the rejected abortTurn nor the rejected stop may surface.
      await expect(handle.dispose()).resolves.toBeUndefined()
    }
  })

  it('latches a wake behind maintenance and replays it when maintenance ends', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, emit) => {
      emit({ type: 'idle', aborted: false })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('maintenance-latch'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      let releaseMaintenance: (() => void) | undefined
      const maintenance = handle.agent.runMaintenance(async () => {
        await new Promise<void>((resolve) => { releaseMaintenance = resolve })
      })

      // The followup arrives while maintenance owns the phase: it must wait.
      prompt(handle.agent, 'queued behind maintenance')
      releaseMaintenance?.()
      await maintenance
      await handle.agent.whenIdle()

      expect(adapter.turns).toEqual(['queued behind maintenance'])
    } finally {
      await handle.dispose()
    }
  })
})

describe('structured turn failures', () => {
  it('keeps an LlmError as the turn/end failure facts', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async () => {
      throw new LlmError('provider rate limited', 'RATE_LIMIT', { status: 429 })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('llm-error-turn'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'ask')
      await handle.agent.whenIdle()

      const turnEnd = handle.agent.session.snapshotEvents().at(-1)
      expect(turnEnd?.type).toBe('turn/end')
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({
        kind: 'error',
        error: { message: 'provider rate limited', code: 'RATE_LIMIT', status: 429 },
      })
    } finally {
      await handle.dispose()
    }
  })
})

describe('degraded stream events', () => {
  it('bridges malformed-ish events without fabricating structure', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, emit) => {
      emit({ type: 'run_started' })
      emit({ type: 'message_delta', delta: 'one ', kind: 'text' })
      // Consecutive deltas of the same kind keep one block index.
      emit({ type: 'message_delta', delta: 'two', kind: 'text' })
      emit({ type: 'tool_started', toolCallId: 't9', toolName: 'probe', args: undefined })
      // An orphan finish pairs with no recorded call.
      emit({ type: 'tool_finished', toolCallId: 'orphan', toolName: 'probe', result: 'x', isError: false })
      emit({ type: 'state_changed' })
      emit({ type: 'idle', aborted: false })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('degraded-events'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'probe')
      await handle.agent.whenIdle()

      const events = handle.agent.session.snapshotEvents()
      const assistant = events.find(event => event.type === 'assistant/message')
      if (assistant?.type !== 'assistant/message') throw new Error('expected an assistant/message')
      expect(assistant.data.message.content).toEqual([{ type: 'text', text: 'one two' }])

      const call = events.find(event => event.type === 'tool/call')
      if (call?.type !== 'tool/call') throw new Error('expected tool/call')
      expect(call.data.arguments).toBe('{}')

      const result = events.find(event => event.type === 'tool/result')
      if (result?.type !== 'tool/result') throw new Error('expected tool/result')
      expect(result.sourceEventSeqs).toBeUndefined()

      expect(events.some(event => event.type === 'request/context')).toBe(false)
    } finally {
      await handle.dispose()
    }
  })

  it('contains a failing turn/end settlement as a boundary error', async () => {
    const ctx = await harness()
    const adapter = new FakeAdapter(async (_input, emit) => {
      emit({ type: 'message_delta', delta: 'answer', kind: 'text' })
      emit({ type: 'idle', aborted: false })
    })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('settlement-failure'),
      driver: (loopCtx, id, options, session) => new ExternalAgentDriver(loopCtx, id, options, session, { adapter }),
    })

    try {
      const real = handle.agent.session.append.bind(handle.agent.session) as (...args: unknown[]) => unknown
      vi.spyOn(handle.agent.session, 'append').mockImplementation(((type: unknown, data: unknown, opts: unknown) => {
        if (type === 'turn/end') throw new Error('log closed')
        return real(type, data, opts)
      }) as unknown as typeof handle.agent.session.append)

      prompt(handle.agent, 'ask')
      await handle.agent.whenIdle()

      const events = handle.agent.session.snapshotEvents()
      // The turn ran, but its end could not be recorded: the failure is
      // reported at the boundary and contained, never silently swallowed.
      expect(events.some(event => event.type === 'turn/end')).toBe(false)
      expect(events.some(event => event.type === 'assistant/message')).toBe(true)
    } finally {
      await handle.dispose()
    }
  })
})
