/**
 * Tests for the Pi-specific independent loop agent.
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
import type { ExternalRuntimeAdapter, ExternalRuntimeCapabilities, ExternalRuntimeEvent } from '../src/external-runtime.ts'
import { createPiLoopDriver, PiLoopAgent } from '../src/pi-loop-agent.ts'

type Emit = (event: ExternalRuntimeEvent) => void
type Script = (input: string, emit: Emit, signal: AbortSignal) => Promise<void>

class FakePiAdapter implements ExternalRuntimeAdapter {
  readonly runtimeId = 'pi' as const
  readonly runtimeVersion = '0.42.0-test'
  started = false
  stopped = false
  turns: string[] = []
  aborts = 0
  requests: { method: string; params?: unknown }[] = []
  private readonly listeners = new Set<(event: ExternalRuntimeEvent) => void>()

  constructor(private readonly script: Script) {}

  capabilities(): ExternalRuntimeCapabilities {
    return { streaming: true, steering: true, followUp: true, hostPermission: false, hostUserInput: false, hostSideToolExecution: false }
  }

  async start(): Promise<void> { this.started = true }
  async stop(): Promise<void> { this.stopped = true }
  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    // The live steer channel fails like a real one: the driver must swallow
    // the rejection and let the queued inbox delivery carry the message.
    if (method === 'steer') throw new Error('steer channel closed')
    return {}
  }
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

function prompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('PiLoopAgent', () => {
  it('drives multi-round Pi turns into discrete DSH steps', async () => {
    const ctx = await harness()
    const adapter = new FakePiAdapter(async (_input, emit) => {
      emit({ type: 'run_started' })
      emit({ type: 'message_started', message: { role: 'assistant' } })
      emit({ type: 'message_delta', delta: 'thinking about tools', kind: 'thinking' })
      emit({ type: 'message_delta', delta: 'fetching file', kind: 'text' })
      emit({ type: 'tool_started', toolCallId: 't1', toolName: 'read', args: { path: 'a.txt' } })
      emit({ type: 'tool_finished', toolCallId: 't1', toolName: 'read', result: 'file content', isError: false })
      emit({ type: 'message_finished', message: { role: 'assistant' } })
      // Next model round in same turn
      emit({ type: 'message_started', message: { role: 'assistant' } })
      emit({ type: 'message_delta', delta: 'analyzed content', kind: 'text' })
      emit({ type: 'message_finished', message: { role: 'assistant' } })
      emit({ type: 'idle', aborted: false })
    })

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('pi-multi-round'),
      agentOptions: { provider: 'pi', model: 'pi-model' },
      driver: createPiLoopDriver(adapter),
    })

    try {
      prompt(handle.agent, 'inspect')
      await handle.agent.whenIdle()

      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
      expect(events.filter(event => event.type === 'step/start')).toHaveLength(2)

      const assistants = events.filter(event => event.type === 'assistant/message')
      expect(assistants).toHaveLength(2)
      if (assistants[0]?.type === 'assistant/message') {
        expect(assistants[0].data.message.content).toEqual([
          { type: 'reasoning', text: 'thinking about tools' },
          { type: 'text', text: 'fetching file' },
        ])
        expect(assistants[0].data.message.source).toMatchObject({ provider: 'pi', model: 'pi-model' })
      }
      if (assistants[1]?.type === 'assistant/message') {
        expect(assistants[1].data.message.content).toEqual([
          { type: 'text', text: 'analyzed content' },
        ])
      }
    } finally {
      await handle.dispose()
    }
  })

  it('dispatches live steer command to running Pi adapter', async () => {
    const ctx = await harness()
    const adapter = new FakePiAdapter(async (_input, emit, signal) => {
      emit({ type: 'message_delta', delta: 'working...', kind: 'text' })
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (signal.aborted || adapter.requests.some(r => r.method === 'steer')) {
            clearInterval(check)
            resolve()
          }
        }, 10)
      })
      emit({ type: 'idle', aborted: false })
    })

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('pi-steer-test'),
      driver: (loopCtx, id, options, session) => new PiLoopAgent(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'start long task')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })

      handle.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'stop and focus on X' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()

      expect(adapter.requests.some(r => r.method === 'steer')).toBe(true)
      const steerReq = adapter.requests.find(r => r.method === 'steer')
      expect(steerReq?.params).toEqual({ message: 'stop and focus on X' })
    } finally {
      await handle.dispose()
    }
  })

  it('queues a steer sent while idle without pinging the adapter', async () => {
    const ctx = await harness()
    const adapter = new FakePiAdapter(async (_input, emit) => {
      emit({ type: 'message_delta', delta: 'done', kind: 'text' })
      emit({ type: 'idle', aborted: false })
    })

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('pi-steer-idle'),
      driver: (loopCtx, id, options, session) => new PiLoopAgent(loopCtx, id, options, session, { adapter }),
    })

    try {
      // Steered before any turn: the agent is idle, so the message only joins
      // the inbox and the live `steer` RPC must not fire.
      handle.agent.steer(createUserMessage({ content: [{ type: 'text', text: 'first thought' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      prompt(handle.agent, 'go')
      await handle.agent.whenIdle()

      // The idle steer opened its own turn; the live RPC never fired.
      expect(adapter.turns).toEqual(['first thought', 'go'])
      expect(adapter.requests.some(r => r.method === 'steer')).toBe(false)
    } finally {
      await handle.dispose()
    }
  })

  it('stops adapter on disposal and supports abortTurn', async () => {
    const ctx = await harness()
    const adapter = new FakePiAdapter(async (_input, emit, signal) => {
      emit({ type: 'message_delta', delta: 'running...', kind: 'text' })
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('pi-abort-test'),
      driver: createPiLoopDriver(adapter),
    })

    try {
      prompt(handle.agent, 'hang')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })
      handle.agent.cancel({ kind: 'user' })
      await handle.agent.whenIdle()

      expect(adapter.aborts).toBe(1)
    } finally {
      await handle.dispose()
      expect(adapter.stopped).toBe(true)
    }
  })
})
