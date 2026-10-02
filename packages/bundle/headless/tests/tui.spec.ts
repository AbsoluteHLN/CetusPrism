/**
 * The live terminal UI: the pure renderer's layout (header, status line,
 * reasoning/answer streaming, tool cards, footer) and the projection that wires
 * one Agent's stream and Session events into it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { LlmAttemptId, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord, ContentBlock, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SurfaceOp } from '@deepseek-ai/dsh-session'
import { internals } from '../src/runner-internals.ts'
import { MIN_WIDTH, createTuiRenderer, type TuiRenderer, type TuiRendererOptions, type TuiSink } from '../src/tui-renderer.ts'
import { projectTuiRun } from '../src/tui.ts'

/** A sink that records every chunk and exposes the joined layout. */
function makeSink(): TuiSink & { chunks: string[]; text: () => string } {
  const chunks: string[] = []
  return {
    write(chunk: string) {
      chunks.push(chunk)
    },
    chunks,
    text: () => chunks.join(''),
  }
}

interface RendererHarness {
  readonly renderer: TuiRenderer
  readonly sink: ReturnType<typeof makeSink>
  /** Run every captured spinner redraw once. */
  readonly tick: () => void
}

/** Build one renderer over a recording sink with a manual ticker and a fixed clock. */
function makeRenderer(options: Partial<TuiRendererOptions> = {}): RendererHarness {
  const sink = makeSink()
  const redraws: Array<() => void> = []
  const full: TuiRendererOptions = {
    width: 60,
    color: false,
    animate: false,
    now: () => 0,
    ...options,
    ticker: (redraw) => {
      redraws.push(redraw)
      return () => {}
    },
  }
  return {
    renderer: createTuiRenderer(sink, full),
    sink,
    tick: () => { for (const redraw of redraws.splice(0)) redraw() },
  }
}

const INFO = { sessionId: 'session-1234567890', provider: 'deepseek', model: 'deepseek-chat', cwd: '/work' }

/** Strip ANSI escape sequences from a line. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/** The visible (ANSI-stripped) lines of a layout, without the final terminator. */
function lines(sink: ReturnType<typeof makeSink>): string[] {
  const text = stripAnsi(sink.text())
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
}

describe('TUI renderer layout', () => {
  it('prints a bordered header card with model, session, and cwd', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    const out = lines(sink)
    expect(out[0]).toMatch(/^╭─+╮$/)
    expect(out[0]).toHaveLength(60)
    expect(out[1]).toContain('CetusPrism')
    expect(out[1]).toContain('deepseek/deepseek-chat')
    expect(out[2]).toContain('session-1234567890')
    expect(out[2]).toContain('/work')
    expect(out[3]).toMatch(/^╰─+╯$/)
    expect(out[3]).toHaveLength(60)
  })

  it('omits the cwd from the header when absent', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin({ sessionId: 'session-abc', provider: 'p', model: 'm' })
    const meta = lines(sink)[2]
    expect(meta).toContain('session-abc')
    expect(meta).not.toContain('undefined')
  })

  it('clamps the layout width up to the minimum', () => {
    const { renderer, sink } = makeRenderer({ width: 10 })
    renderer.begin(INFO)
    expect(lines(sink)[0]).toHaveLength(MIN_WIDTH)
  })

  it('truncates an overlong model, session, and cwd to fit the box', () => {
    const { renderer, sink } = makeRenderer({ width: 44 })
    // A wide (CJK) session id exercises the two-column branch of clip.
    renderer.begin({
      sessionId: `session-${'汉'.repeat(30)}`,
      provider: 'prov',
      model: 'm'.repeat(60),
      cwd: '/a/'.repeat(40),
    })
    const out = lines(sink)
    expect(out[1]).toContain('…')
    expect(out[2]).toContain('…')
    for (const line of out.slice(0, 4)) {
      expect(line.length).toBeLessThanOrEqual(44)
    }
  })

  it('paints the header with ANSI codes when color is on', () => {
    const { renderer, sink } = makeRenderer({ color: true })
    renderer.begin(INFO)
    const out = sink.text()
    expect(out).toContain('\x1b[1m')
    expect(out).toContain('\x1b[36m')
    expect(out).toContain('\x1b[2m')
    // Colored lines still fit the width by visible columns.
    for (const line of stripAnsi(out).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })

  it('emits a plain status line per phase change when not animating', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.setPhase('thinking')
    renderer.setPhase('thinking')
    const out = sink.text()
    expect(out).toContain('starting')
    const matches = out.match(/thinking/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('shows the elapsed time on the status line as the clock advances', () => {
    let clock = 500
    const { renderer, sink } = makeRenderer({ now: () => clock })
    renderer.begin(INFO)
    clock = 600
    renderer.setPhase('working')
    expect(sink.text()).toContain('100 ms')
    clock = 2400
    renderer.setPhase('still working')
    expect(sink.text()).toContain('1.9 s')
  })

  it('draws a status line without elapsed time before begin', () => {
    const { renderer, sink } = makeRenderer({ animate: true })
    renderer.setPhase('thinking')
    expect(sink.text()).toContain('⠋ thinking')
    expect(sink.text()).not.toContain('\r')
    expect(sink.text()).not.toContain(' ms')
  })

  it('redraws the status line in place and advances the spinner when animating', () => {
    const { renderer, sink, tick } = makeRenderer({ animate: true })
    renderer.begin(INFO)
    renderer.setPhase('thinking')
    // A second begin must not start a second ticker.
    renderer.begin(INFO)
    tick()
    const out = sink.text()
    expect(out).toContain('\r\x1b[2K')
    expect(out).toContain('⠙ thinking')
  })

  it('streams complete reasoning lines under a gutter and holds the tail', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.reasoning('first line\nsecond')
    let out = sink.text()
    expect(out).toContain('│ first line')
    expect(out).not.toContain('second')
    renderer.reasoning(' line done\n')
    out = sink.text()
    expect(out).toContain('│ second line done')
  })

  it('ignores an empty reasoning or answer delta', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    // begin alone renders four box lines plus the status line (five non-blank).
    const before = lines(sink).filter(line => line.trim() !== '').length
    renderer.reasoning('')
    renderer.answer('')
    // No reasoning rail line (two-space gutter + rail) may appear; the header
    // box lines own the bare borders.
    expect(sink.text()).not.toContain('  │ ')
    expect(lines(sink).filter(line => line.trim() !== '')).toHaveLength(before)
  })

  it('wraps long answer text at the layout width', () => {
    const { renderer, sink } = makeRenderer({ width: 40 })
    renderer.begin(INFO)
    // The double space exercises the empty-word branch of the wrapper.
    renderer.answer(`${Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')}  done\n`)
    for (const line of lines(sink)) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
    expect(lines(sink).some(line => line.endsWith('done'))).toBe(true)
  })

  it('hard-breaks a single word wider than the layout', () => {
    const { renderer, sink } = makeRenderer({ width: 40 })
    renderer.begin(INFO)
    renderer.answer(`${'x'.repeat(90)}\n`)
    for (const line of lines(sink)) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
  })

  it('wraps wide CJK characters as two columns and keeps blank lines', () => {
    const { renderer, sink } = makeRenderer({ width: MIN_WIDTH })
    renderer.begin({ sessionId: 's', provider: 'p', model: 'm' })
    // 20 CJK characters (40 columns) plus three wide astral glyphs (6 columns)
    // cannot fit the 38-column answer budget: the hard break lands after 19
    // characters. The glyphs sample the emoji, supplemental, and CJK Extension
    // B bands of the width table.
    renderer.answer(`${'汉'.repeat(20)}🎉🥰𠀀\n\nmore\n`)
    const out = lines(sink)
    const cjkLines = out.filter(line => line.includes('汉'))
    expect(cjkLines).toHaveLength(2)
    expect(cjkLines[1]).toContain('🎉')
    expect(cjkLines[1]).toContain('🥰')
    expect(cjkLines[1]).toContain('𠀀')
    expect(out).toContain('')
  })

  it('flushStream emits the unterminated tail', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.answer('pending tail')
    expect(sink.text()).not.toContain('pending tail')
    renderer.flushStream('answer')
    expect(sink.text()).toContain('pending tail')
  })

  it('prints a tool card with a truncated summary', () => {
    const { renderer, sink } = makeRenderer({ width: 44 })
    renderer.begin(INFO)
    renderer.toolStart('read', `${'/a/'.repeat(20)}tail`)
    const out = lines(sink)
    const card = out.find(line => line.includes('read'))
    expect(card).toBeDefined()
    expect(card).toContain('…')
    expect(card).toHaveLength(44)
  })

  it('prints a tool card without a summary', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.toolStart('read', '')
    const card = lines(sink).find(line => line.includes('read'))
    expect(card).toBeDefined()
    expect(card?.trimEnd()).toBe('  ◈ read')
  })

  it('truncates the summary to the columns left by the label', () => {
    const { renderer, sink } = makeRenderer({ width: MIN_WIDTH })
    renderer.begin(INFO)
    renderer.toolStart('read', 's'.repeat(50))
    const card = lines(sink).find(line => line.includes('read'))
    expect(card).toBeDefined()
    expect(card).toHaveLength(MIN_WIDTH)
    expect(card).toContain('…')
  })

  it('prints a completed tool result with duration and size', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.toolStart('read', 'src/index.ts')
    renderer.toolResult({ ok: true, durationMs: 120, text: 'a\nb\nc' })
    const fact = lines(sink).find(line => line.includes('✓'))
    expect(fact).toContain('120 ms')
    // The size counts the text verbatim, newlines included: five bytes.
    expect(fact).toContain('5 B')
  })

  it('prints a tool result without a duration', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.toolStart('read', 'x')
    renderer.toolResult({ ok: true, text: 'a'.repeat(2048) })
    const fact = lines(sink).find(line => line.includes('✓'))
    expect(fact).toContain('2.0 KB')
    expect(fact).not.toContain('ms ·')
  })

  it('prints a failed tool result with an error preview', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.toolStart('bash', 'ls /nope')
    renderer.toolResult({ ok: false, durationMs: 5, text: '\n  ENOENT: no such file\n' })
    const fact = lines(sink).find(line => line.includes('✗'))
    expect(fact).toContain('ENOENT: no such file')
  })

  it('prints a failed tool result with an empty preview', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.toolStart('bash', 'x')
    renderer.toolResult({ ok: false, text: '' })
    const fact = lines(sink).find(line => line.includes('✗'))
    // The result line sits one level under the tool card: gutter + card indent.
    expect(fact?.trimEnd()).toBe('    ✗ 0 B')
  })

  it('prints a neutral note line', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.note('attempt interrupted')
    expect(sink.text()).toContain('· attempt interrupted')
  })

  it('settles the animated status line before a tool card', () => {
    const { renderer, sink } = makeRenderer({ animate: true })
    renderer.begin(INFO)
    renderer.setPhase('thinking')
    renderer.toolStart('read', 'x')
    const out = lines(sink)
    const card = out.findIndex(line => line.includes('read'))
    expect(card).toBeGreaterThan(-1)
    expect(out[card]?.startsWith('  ◈')).toBe(true)
  })
})

describe('TUI renderer footer', () => {
  it('prints a completed footer with duration, steps, tools, and tokens', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.finish({
      ok: true,
      label: 'completed',
      elapsedMs: 4200,
      steps: 3,
      tools: 2,
      toolErrors: 0,
      usage: { inputTokens: 1000, outputTokens: 250, cacheReadTokens: 500 },
      usageComplete: true,
    })
    const footer = lines(sink).at(-1)
    expect(footer).toContain('✓')
    expect(footer).toContain('completed')
    expect(footer).toContain('4.2 s')
    expect(footer).toContain('3 steps')
    expect(footer).toContain('2 tools')
    expect(footer).toContain('1.5k in / 250 out')
  })

  it('prints singular step and tool labels and a rounded token count', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.finish({
      ok: true,
      label: 'completed',
      elapsedMs: 100,
      steps: 1,
      tools: 1,
      toolErrors: 0,
      usage: { inputTokens: 12345, outputTokens: 999 },
      usageComplete: true,
    })
    const footer = lines(sink).at(-1)
    expect(footer).toContain('1 step')
    expect(footer).toContain('1 tool')
    expect(footer).toContain('12k in / 999 out')
  })

  it('reports minutes for long runs and omits zero steps and tools', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.finish({
      ok: true,
      label: 'completed',
      elapsedMs: 65000,
      steps: 0,
      tools: 0,
      toolErrors: 0,
      usageComplete: false,
    })
    const footer = lines(sink).at(-1)
    expect(footer).toContain('1 min 5 s')
    expect(footer).not.toContain('step')
    expect(footer).not.toContain('tool')
  })

  it('omits the token count when usage is absent or incomplete', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.finish({ ok: true, label: 'completed', elapsedMs: 1, steps: 0, tools: 0, toolErrors: 0, usageComplete: false })
    expect(sink.text()).not.toContain(' in / ')
    const second = makeRenderer()
    second.renderer.begin(INFO)
    second.renderer.finish({
      ok: true,
      label: 'completed',
      elapsedMs: 1,
      steps: 0,
      tools: 0,
      toolErrors: 0,
      usage: { inputTokens: 10, outputTokens: 5 },
      usageComplete: false,
    })
    expect(second.sink.text()).not.toContain(' in / ')
  })

  it('marks a failed footer and reports failed tools', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.finish({
      ok: false,
      label: 'aborted',
      elapsedMs: 100,
      steps: 1,
      tools: 2,
      toolErrors: 1,
      usageComplete: false,
    })
    const footer = lines(sink).at(-1)
    expect(footer).toContain('✗')
    expect(footer).toContain('aborted')
    expect(footer).toContain('1 failed')
  })

  it('prints an error footer, clips a long message, and stops the spinner', () => {
    const { renderer, sink, tick } = makeRenderer({ animate: true })
    renderer.begin(INFO)
    renderer.fail(`SERVER: ${'x'.repeat(200)}`)
    tick()
    const out = lines(sink)
    expect(out.at(-1)).toContain('✗')
    expect(out.at(-1)).toContain('…')
    expect(out.at(-1)).toHaveLength(60)
    // The layout is terminal: every later call writes nothing.
    const before = sink.chunks.length
    renderer.answer('late')
    renderer.reasoning('late')
    renderer.finish({ ok: true, label: 'x', elapsedMs: 1, steps: 0, tools: 0, toolErrors: 0, usageComplete: false })
    renderer.toolStart('late', 'x')
    renderer.toolResult({ ok: true, text: 'x' })
    renderer.note('late')
    renderer.flushStream('answer')
    renderer.fail('again')
    expect(sink.chunks.length).toBe(before)
  })

  it('dispose stops the ticker and silences the layout', () => {
    const { renderer, sink, tick } = makeRenderer({ animate: true })
    renderer.begin(INFO)
    renderer.dispose()
    tick()
    const before = sink.chunks.length
    renderer.begin(INFO)
    renderer.setPhase('thinking')
    renderer.answer('late')
    expect(sink.chunks.length).toBe(before)
  })

  it('falls back to the default width and clock when options are omitted', () => {
    const sink = makeSink()
    const renderer = createTuiRenderer(sink)
    renderer.begin(INFO)
    const out = lines(sink)
    expect(out[0]).toMatch(/^╭─+╮$/)
    expect(out[0]).toHaveLength(80)
  })

  it('formats byte sizes in B, KB, and MB', () => {
    const { renderer, sink } = makeRenderer()
    renderer.begin(INFO)
    renderer.toolStart('read', 'a')
    renderer.toolResult({ ok: true, text: 'a'.repeat(2 * 1024 * 1024) })
    renderer.toolStart('read', 'b')
    renderer.toolResult({ ok: true, text: 'a'.repeat(3072) })
    const facts = lines(sink).filter(line => line.includes('✓'))
    expect(facts[0]).toContain('2.0 MB')
    expect(facts[1]).toContain('3.0 KB')
  })
})

/** One stream chunk frame for the test Agent. */
function frameChunk(chunk: StreamChunk, index = 0): AssistantStreamFrame {
  return { type: 'chunk', attemptId: LlmAttemptId('attempt-1'), revision: 1, index, time: 0, chunk }
}

/** One stream end frame with the given outcome. */
function frameEnd(outcome: Extract<AssistantStreamFrame, { type: 'end' }>['outcome']): AssistantStreamFrame {
  return { type: 'end', attemptId: LlmAttemptId('attempt-1'), revision: 2, index: 1, outcome }
}

interface ProjectionHarness {
  readonly sink: ReturnType<typeof makeSink>
  readonly projection: ReturnType<typeof projectTuiRun>
  readonly emitFrame: (frame: AssistantStreamFrame) => void
  readonly emitFrameFor: (agent: Agent, frame: AssistantStreamFrame) => void
  readonly emitSession: (event: SessionEvent) => void
  readonly emitForeign: (event: SessionEvent) => void
}

/** Every Context this file booted, disposed by the teardown hook. */
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/**
 * A minimal Agent identity double over a bare Session stand-in: the projection
 * only reads `agent.id` and filters events on `agent.session` identity.
 * @param id - the Session identity the double carries.
 * @param session - the Session identity its events must carry.
 * @returns the Agent the projection observes.
 */
function agentDouble(id: string, session: Session): Agent {
  return { id: SessionId(id), session } as Agent
}

/** Drive the TUI projection through one real Context and Agent double. */
function projectionHarness(options: Parameters<typeof projectTuiRun>[4] = {}): ProjectionHarness {
  const sink = makeSink()
  const ctx = new Context()
  contexts.push(ctx)
  const session = {} as Session
  const agent = agentDouble('session-9', session)
  const projection = projectTuiRun(ctx, agent, {
    write: (chunk: string) => { sink.chunks.push(chunk); return true },
  }, { sessionId: 'session-9', provider: 'p', model: 'm', cwd: '/w' }, {
    width: 60,
    color: false,
    animate: false,
    now: () => 0,
    ticker: () => () => {},
    ...options,
  })
  const foreignSession = {} as Session
  return {
    sink,
    projection,
    emitFrame: (frame) => { ctx.emit('agent/assistant-stream', { agent, frame }) },
    emitFrameFor: (other, frame) => { ctx.emit('agent/assistant-stream', { agent: other, frame }) },
    emitSession: (event) => { ctx.emit('session/event', session, event) },
    emitForeign: (event) => { ctx.emit('session/event', foreignSession, event) },
  }
}

/** One committed assistant message, optionally carrying usage. */
function assistantMessageEvent(content: ContentBlock[], usage?: TokenUsage): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(0),
    time: 0,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('message-1'),
        role: 'assistant',
        content,
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
      stream: [],
      ...(usage === undefined ? {} : { usage }),
    },
    surfaceOp: 'append',
  }
}

/** One committed attempt whose stream optionally reports a usage sample. */
function attemptEvent(usage?: TokenUsage): SessionEvent<'assistant/attempt'> {
  const stream: AssistantStreamRecord[] = usage === undefined
    ? []
    : [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage } }]
  return { type: 'assistant/attempt', seq: SessionSeq(0), time: 0, data: { turn: 1, step: 1, stream } }
}

/** One step boundary event. */
function stepEvent(kind: 'start' | 'end'): SessionEvent<'step/start' | 'step/end'> {
  return kind === 'start'
    ? { type: 'step/start', seq: SessionSeq(0), time: 0, data: { turn: 1, step: 1 } }
    : { type: 'step/end', seq: SessionSeq(0), time: 0, data: { turn: 1, step: 1 } }
}

/** One tool call event with raw JSON arguments. */
function toolCallEvent(callId: ToolCallId, name: string, raw: string, time: number): SessionEvent<'tool/call'> {
  return { type: 'tool/call', seq: SessionSeq(0), time, data: { turn: 1, step: 1, callId, name, arguments: raw } }
}

/** One tool result event placed on the surface with the given op. */
function toolResultEvent(callId: ToolCallId, text: string, time: number, isError: boolean, surfaceOp: SurfaceOp = 'append'): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq: SessionSeq(0),
    time,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('tool-1'),
        role: 'tool',
        content: [{ type: 'text', text }],
        source: { kind: 'tool', callId },
        toolCallId: callId,
        ...(isError ? { isError: true } : {}),
      },
    },
    surfaceOp,
  }
}

describe('TUI projection', () => {
  it('prints the header immediately', () => {
    const { sink } = projectionHarness()
    const out = lines(sink)
    expect(out[0]).toMatch(/^╭─+╮$/)
    expect(out[1]).toContain('p/m')
    expect(out[2]).toContain('/w')
  })

  it('streams live answer text and does not reprint the commit', () => {
    const { projection, sink, emitFrame, emitSession } = projectionHarness()
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'hello ' }, 0))
    emitFrame(frameChunk({ type: 'text-delta', index: 1, text: 'world\n' }, 1))
    expect(sink.text()).toContain('hello world')
    emitSession(assistantMessageEvent([{ type: 'text', text: 'hello world\n' }]))
    expect(sink.text().split('hello world').length - 1).toBe(1)
    projection.finish({ kind: 'completed' })
  })

  it('prints committed text that never streamed', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(assistantMessageEvent([{ type: 'text', text: 'only committed' }]))
    expect(sink.text()).toContain('only committed')
    projection.finish({ kind: 'completed' })
  })

  it('does not reprint reasoning that already streamed live', () => {
    const { projection, sink, emitFrame, emitSession } = projectionHarness()
    emitFrame(frameChunk({ type: 'reasoning-delta', index: 0, text: 'live thought\n' }, 0))
    expect(sink.text()).toContain('live thought')
    // The commit carries the durable record of what the live frames showed.
    emitSession(assistantMessageEvent([{ type: 'reasoning', text: 'live thought' }]))
    expect(sink.text().split('live thought').length - 1).toBe(1)
    projection.finish({ kind: 'completed' })
  })

  it('prints committed reasoning that never streamed', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(assistantMessageEvent([{ type: 'reasoning', text: 'only committed' }]))
    expect(sink.text().split('only committed').length - 1).toBe(1)
    projection.finish({ kind: 'completed' })
  })

  it('notes an interrupted attempt', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(attemptEvent())
    expect(sink.text()).toContain('attempt interrupted')
    projection.finish({ kind: 'completed' })
  })

  it('ignores an empty text or reasoning delta', () => {
    const { projection, sink, emitFrame, emitSession } = projectionHarness()
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: '' }, 0))
    emitFrame(frameChunk({ type: 'reasoning-delta', index: 0, text: '' }, 1))
    emitSession(assistantMessageEvent([{ type: 'text', text: 'committed\n' }]))
    expect(sink.text()).toContain('committed')
    projection.finish({ kind: 'completed' })
  })

  it('renders a tool call and result with a duration from event times', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(toolCallEvent(ToolCallId('call-1'), 'read', '{"file_path":"/a.ts"}', 1000))
    expect(sink.text()).toContain('read')
    expect(sink.text()).toContain('/a.ts')
    emitSession(toolResultEvent(ToolCallId('call-1'), 'line1\nline2', 1042, false))
    const fact = lines(sink).find(line => line.includes('✓'))
    expect(fact).toContain('42 ms')
    projection.finish({ kind: 'completed' })
  })

  it('renders a tool result with no recorded call time', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(toolResultEvent(ToolCallId('call-x'), 'x', 50, false))
    const fact = lines(sink).find(line => line.includes('✓'))
    expect(fact).not.toContain('ms')
    projection.finish({ kind: 'completed' })
  })

  it('ignores a non-append tool result', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(toolResultEvent(ToolCallId('call-r'), 'replaced', 50, false, { op: 'replace', startSeq: SessionSeq(1), endSeq: SessionSeq(2) }))
    expect(sink.text()).not.toContain('replaced')
    projection.finish({ kind: 'completed' })
  })

  it('summarizes tool arguments by preferred key, first string, or compact JSON', () => {
    const preferred = projectionHarness()
    preferred.emitSession(toolCallEvent(ToolCallId('c'), 't', '{"prompt":"ask the model","file_path":"/f.ts"}', 0))
    // The preference list ranks file_path before prompt.
    expect(preferred.sink.text()).toContain('/f.ts')
    expect(preferred.sink.text()).not.toContain('ask the model')
    expect(preferred.sink.text()).not.toContain('"file_path"')
    preferred.projection.dispose()

    const firstString = projectionHarness()
    firstString.emitSession(toolCallEvent(ToolCallId('c'), 't', '{"zzz":"deep","yyy":"shallow"}', 0))
    expect(firstString.sink.text()).toContain('deep')
    firstString.projection.dispose()

    const json = projectionHarness()
    json.emitSession(toolCallEvent(ToolCallId('c'), 't', '{"n":1}', 0))
    expect(json.sink.text()).toContain('{"n":1}')
    json.projection.dispose()

    const empty = projectionHarness()
    empty.emitSession(toolCallEvent(ToolCallId('c'), 't', '{}', 0))
    expect(empty.sink.text()).not.toContain('{}')
    empty.projection.dispose()

    const raw = projectionHarness()
    raw.emitSession(toolCallEvent(ToolCallId('c'), 't', 'plain text', 0))
    expect(raw.sink.text()).toContain('plain text')
    raw.projection.dispose()

    const array = projectionHarness()
    array.emitSession(toolCallEvent(ToolCallId('c'), 't', '["a"]', 0))
    expect(array.sink.text()).not.toContain('["a"]')
    array.projection.dispose()

    const nullish = projectionHarness()
    nullish.emitSession(toolCallEvent(ToolCallId('c'), 't', 'null', 0))
    expect(nullish.sink.text()).not.toContain('null')
    nullish.projection.dispose()

    const numeric = projectionHarness()
    numeric.emitSession(toolCallEvent(ToolCallId('c'), 't', '42', 0))
    expect(numeric.sink.text()).not.toContain('42')
    numeric.projection.dispose()
  })

  it('accumulates usage across attempts and messages into the footer', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(attemptEvent({ inputTokens: 100, outputTokens: 10 }))
    emitSession(assistantMessageEvent([{ type: 'text', text: 'ok\n' }], { inputTokens: 200, outputTokens: 20 }))
    projection.finish({ kind: 'completed' })
    expect(sink.text()).toContain('300 in / 30 out')
  })

  it('marks usage incomplete when an attempt omits a sample', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(assistantMessageEvent([{ type: 'text', text: 'ok\n' }], { inputTokens: 5, outputTokens: 5 }))
    emitSession(attemptEvent())
    projection.finish({ kind: 'completed' })
    expect(sink.text()).not.toContain(' in / ')
  })

  it('reads a message usage from its stream when no top-level usage is present', () => {
    const { projection, sink, emitSession } = projectionHarness()
    const event = assistantMessageEvent([{ type: 'text', text: 'ok\n' }])
    event.data.stream = [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } } }]
    emitSession(event)
    projection.finish({ kind: 'completed' })
    expect(sink.text()).toContain('7 in / 3 out')
  })

  it('counts steps and tools into the footer and flags failed tools', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(stepEvent('start'))
    emitSession(stepEvent('end'))
    emitSession(stepEvent('end'))
    emitSession(toolCallEvent(ToolCallId('c1'), 'read', '{}', 0))
    emitSession(toolResultEvent(ToolCallId('c1'), 'x', 1, false))
    emitSession(toolCallEvent(ToolCallId('c2'), 'bash', '{}', 0))
    emitSession(toolResultEvent(ToolCallId('c2'), 'boom', 1, true))
    projection.finish({ kind: 'completed' })
    const footer = lines(sink).at(-1)
    expect(footer).toContain('2 steps')
    expect(footer).toContain('2 tools')
    expect(footer).toContain('1 failed')
  })

  it('resets the streamed flags at step and frame starts', () => {
    const { projection, sink, emitFrame, emitSession } = projectionHarness()
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'first\n' }, 0))
    emitSession(assistantMessageEvent([{ type: 'text', text: 'first\n' }]))
    emitSession(stepEvent('start'))
    emitSession(assistantMessageEvent([{ type: 'text', text: 'second' }]))
    expect(sink.text().split('second').length - 1).toBe(1)

    const restarted = projectionHarness()
    restarted.emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'a\n' }, 0))
    restarted.emitSession(assistantMessageEvent([{ type: 'text', text: 'a\n' }]))
    restarted.emitFrame({ type: 'start', attemptId: LlmAttemptId('attempt-2'), revision: 1, turn: 1, step: 2 })
    restarted.emitSession(assistantMessageEvent([{ type: 'text', text: 'b' }]))
    expect(restarted.sink.text()).toContain('b')
    restarted.projection.finish({ kind: 'completed' })
    projection.finish({ kind: 'completed' })
  })

  it('tracks phases from stream frames', () => {
    const { projection, sink, emitFrame } = projectionHarness({ animate: true, width: 80 })
    emitFrame({ type: 'start', attemptId: LlmAttemptId('attempt-1'), revision: 1, turn: 1, step: 1 })
    expect(sink.text()).toContain('thinking')
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'x' }, 0))
    expect(sink.text()).toContain('answering')
    emitFrame(frameChunk({ type: 'tool-call-delta', index: 0, id: ToolCallId('c'), name: 'bash', argumentsDelta: '' }, 1))
    expect(sink.text()).toContain('running bash')
    emitFrame(frameChunk({ type: 'tool-call-delta', index: 0, id: ToolCallId('c'), argumentsDelta: '' }, 2))
    emitFrame(frameChunk({ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, 3))
    emitFrame(frameChunk({ type: 'finish', reason: { kind: 'stop' } }, 4))
    emitFrame(frameChunk({ type: 'block-start', index: 0, blockType: 'text' }, 5))
    emitFrame(frameChunk({ type: 'block-end', index: 0, block: { type: 'text', text: 'x' } }, 6))
    projection.finish({ kind: 'completed' })
  })

  it('notes a live-abandoned attempt and flushes its tail', () => {
    const { projection, sink, emitFrame } = projectionHarness()
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'partial' }, 0))
    emitFrame(frameEnd({ kind: 'abandoned' }))
    const out = sink.text()
    expect(out).toContain('partial')
    expect(out).toContain('attempt interrupted')
    projection.finish({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('flushes a committed frame tail without an interruption note', () => {
    const { projection, sink, emitFrame } = projectionHarness()
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'settled' }, 0))
    emitFrame(frameEnd({ kind: 'committed', eventType: 'assistant/message', seq: SessionSeq(3) }))
    const out = sink.text()
    expect(out).toContain('settled')
    expect(out).not.toContain('attempt interrupted')
    projection.finish({ kind: 'completed' })
  })

  it('enters the thinking phase from turn and step starts', () => {
    const { projection, sink, emitSession } = projectionHarness({ animate: true })
    emitSession({ type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } })
    emitSession(stepEvent('start'))
    expect(sink.text()).toContain('thinking')
    projection.finish({ kind: 'completed' })
  })

  it('ignores events from another session or agent', () => {
    const test = projectionHarness()
    const other = agentDouble('session-other', {} as Session)
    test.emitForeign(assistantMessageEvent([{ type: 'text', text: 'foreign' }]))
    test.emitFrameFor(other, frameChunk({ type: 'text-delta', index: 0, text: 'other' }, 0))
    // A real, unhandled event type reaches the documented default branch.
    test.emitSession({ type: 'session/end-seed', seq: SessionSeq(0), time: 0, data: {} })
    expect(test.sink.text()).not.toContain('foreign')
    expect(test.sink.text()).not.toContain('other')
    test.projection.finish({ kind: 'completed' })
  })

  it('maps each turn outcome to a footer label', () => {
    const cases: Array<[Parameters<ReturnType<typeof projectionHarness>['projection']['finish']>[0], string]> = [
      [{ kind: 'completed' }, 'completed'],
      [{ kind: 'aborted', reason: { kind: 'user' } }, 'aborted'],
      [{ kind: 'blocked' }, 'blocked'],
      [{ kind: 'max-tokens' }, 'max tokens reached'],
      [{ kind: 'interrupted' }, 'interrupted'],
      [{ kind: 'forked' }, 'forked'],
      [{ kind: 'error', error: { code: 'SERVER', message: 'down' } }, 'SERVER: down'],
    ]
    for (const [reason, label] of cases) {
      const test = projectionHarness()
      test.projection.finish(reason)
      expect(test.sink.text()).toContain(label)
    }
    const missing = projectionHarness()
    missing.projection.finish(undefined)
    expect(missing.sink.text()).toContain('no turn completed')
  })

  it('fail prints an error footer and dispose stops observation', () => {
    const { projection, sink, emitSession, emitFrame } = projectionHarness()
    projection.fail('boom')
    expect(sink.text()).toContain('boom')
    emitSession(assistantMessageEvent([{ type: 'text', text: 'late' }]))
    emitFrame(frameChunk({ type: 'text-delta', index: 0, text: 'later' }, 0))
    expect(sink.text()).not.toContain('late')
    expect(sink.text()).not.toContain('later')
    // A disposed projection settles nothing from late outcomes.
    const before = sink.chunks.length
    projection.finish({ kind: 'completed' })
    projection.fail('late failure')
    expect(sink.chunks.length).toBe(before)
  })

  it('ignores committed content blocks that are neither text nor reasoning', () => {
    const { projection, sink, emitSession } = projectionHarness()
    emitSession(assistantMessageEvent([
      { type: 'tool-call', id: ToolCallId('tc'), name: 't', arguments: '{}' },
      { type: 'text', text: 'only text' },
    ]))
    expect(sink.text()).toContain('only text')
    expect(sink.text()).not.toContain('tool-call')
    projection.finish({ kind: 'completed' })
  })
})

describe('runner internals', () => {
  it('reads the real process and terminal facts', () => {
    expect(internals.stdoutIsTty()).toBe(process.stdout.isTTY === true)
    expect(internals.stdoutColumns()).toBe(process.stdout.columns)
    expect(internals.noColor()).toBe(process.env.NO_COLOR !== undefined)
  })
})
