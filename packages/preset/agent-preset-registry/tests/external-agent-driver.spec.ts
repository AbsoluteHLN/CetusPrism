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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ExternalRuntimeAdapter, ExternalRuntimeCapabilities, ExternalRuntimeEvent, ExternalRuntimeId } from '../src/external-runtime.ts'
import { ExternalAgentDriver } from '../src/external-agent-driver.ts'

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
