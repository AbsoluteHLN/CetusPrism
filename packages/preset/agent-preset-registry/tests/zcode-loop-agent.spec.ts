/**
 * Tests for the ZCode-specific independent loop agent.
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
import { ZCodeRuntimeAdapter } from '../src/external-runtime-zcode.ts'
import { createZCodeLoopDriver, ZCodeLoopAgent } from '../src/zcode-loop-agent.ts'

type Emit = (event: ExternalRuntimeEvent) => void
type Script = (input: string, emit: Emit, signal: AbortSignal) => Promise<void>

/**
 * A fake ZCode runtime whose turn fails: the driver must record the failure,
 * not a completed turn.
 */
const ZCODE_FAIL_SCRIPT = `
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
      send({ method: 'turn.started', params: { turnNumber: 1 } });
      send({ method: 'model.streaming', params: { kind: 'text_delta', delta: 'partial', assistantMessageId: 'm1', partId: 'p1' } });
      send({ method: 'turn.failed', params: { resultType: 'error', message: 'upstream refused' } });
      send({ id: frame.id, result: { sessionId: 'session-1', accepted: true, stateRevision: 2 } });
    } else if (frame.method === 'session/stop') {
      send({ id: frame.id, result: {} });
    }
  }
});
`

function fakeRuntime(script: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ['-e', script] }
}

class FakeZCodeAdapter implements ExternalRuntimeAdapter {
  readonly runtimeId = 'zcode' as const
  readonly runtimeVersion = '3.16.2-test'
  started = false
  stopped = false
  turns: string[] = []
  aborts = 0
  requests: { method: string; params?: unknown }[] = []
  private readonly listeners = new Set<(event: ExternalRuntimeEvent) => void>()

  constructor(private readonly script: Script) {}

  capabilities(): ExternalRuntimeCapabilities {
    return { streaming: true, steering: true, followUp: true, hostPermission: true, hostUserInput: true, hostSideToolExecution: false }
  }

  async start(): Promise<void> { this.started = true }
  async stop(): Promise<void> { this.stopped = true }
  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
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

describe('ZCodeLoopAgent', () => {
  it('drives a turn through ZCode and records durable session events', async () => {
    const ctx = await harness()
    const notices: ExternalRuntimeEvent[] = []
    const adapter = new FakeZCodeAdapter(async (_input, emit) => {
      emit({ type: 'run_started' })
      emit({ type: 'message_delta', delta: 'analyzing problem', kind: 'thinking' })
      emit({ type: 'message_delta', delta: 'executing command', kind: 'text' })
      emit({ type: 'tool_started', toolCallId: 'zc-1', toolName: 'terminal', args: { cmd: 'dir' } })
      emit({ type: 'tool_finished', toolCallId: 'zc-1', toolName: 'terminal', result: 'file list', isError: false })
      emit({ type: 'notice', level: 'info', message: 'ZCode model step completed' })
      emit({ type: 'state_changed', model: { provider: 'zcode-engine', modelId: 'glm-5.2' } })
      emit({ type: 'idle', aborted: false })
    })

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('zcode-turn'),
      agentOptions: { provider: 'zcode', model: 'glm-5.2' },
      driver: createZCodeLoopDriver(adapter, {
        onNotice: notice => notices.push(notice),
      }),
    })

    try {
      prompt(handle.agent, 'run directory listing')
      await handle.agent.whenIdle()

      expect(adapter.turns).toEqual(['run directory listing'])
      const events = handle.agent.session.snapshotEvents()

      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
      expect(events.filter(event => event.type === 'step/start')).toHaveLength(1)

      const assistant = events.find(event => event.type === 'assistant/message')
      if (assistant?.type !== 'assistant/message') throw new Error('expected an assistant/message')
      expect(assistant.data.message.content).toEqual([
        { type: 'reasoning', text: 'analyzing problem' },
        { type: 'text', text: 'executing command' },
      ])
      expect(assistant.data.message.source).toMatchObject({ provider: 'zcode', model: 'glm-5.2' })

      const call = events.find(event => event.type === 'tool/call')
      const result = events.find(event => event.type === 'tool/result')
      if (call?.type !== 'tool/call' || result?.type !== 'tool/result') throw new Error('expected tool pair')
      expect(call.data).toMatchObject({ callId: 'zc-1', name: 'terminal' })
      expect(result.sourceEventSeqs).toEqual([call.seq])

      expect(notices).toHaveLength(1)
      expect(notices[0]?.type).toBe('notice')
    } finally {
      await handle.dispose()
    }
  })

  it('records a failed ZCode turn as a failed attempt instead of a completed one', async () => {
    const ctx = await harness()
    const adapter = new ZCodeRuntimeAdapter(fakeRuntime(ZCODE_FAIL_SCRIPT))
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('zcode-failed-turn'),
      agentOptions: { provider: 'zcode', model: 'glm-5.2' },
      driver: createZCodeLoopDriver(adapter),
    })

    try {
      prompt(handle.agent, 'run the failing command')
      await handle.agent.whenIdle()

      const events = handle.agent.session.snapshotEvents()
      // The partial text never became a message: the turn failed.
      expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(0)
      expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
      const turnEnd = events.at(-1)
      expect(turnEnd?.type).toBe('turn/end')
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toMatchObject({ kind: 'error' })
    } finally {
      await handle.dispose()
    }
  })

  it('handles cancellation and asks ZCode adapter to abort', async () => {
    const ctx = await harness()
    const adapter = new FakeZCodeAdapter(async (_input, emit, signal) => {
      emit({ type: 'message_delta', delta: 'starting long task', kind: 'text' })
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('zcode-abort'),
      driver: (loopCtx, id, options, session) => new ZCodeLoopAgent(loopCtx, id, options, session, { adapter }),
    })

    try {
      prompt(handle.agent, 'do something slow')
      await vi.waitFor(() => { expect(adapter.turns).toHaveLength(1) })

      handle.agent.cancel({ kind: 'user' })
      await handle.agent.whenIdle()

      expect(adapter.aborts).toBe(1)
      const events = handle.agent.session.snapshotEvents()
      const turnEnd = events.at(-1)
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    } finally {
      await handle.dispose()
      expect(adapter.stopped).toBe(true)
    }
  })
})
