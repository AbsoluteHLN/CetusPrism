/**
 * The live terminal UI projection: like the `--json` projection, it observes
 * one Agent's durable Session events and its assistant stream, but it renders
 * them as the inline layout of {@link TuiRenderer} — header, animated status
 * line, dimmed reasoning, tool cards, streaming answer, and summary footer.
 * Text and reasoning stream live from the attempt's frames; committed
 * `assistant/message` content prints only when the attempt streamed none, so a
 * normal run never prints a block twice.
 * @module @deepseek-ai/dsh-headless/tui
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { addUsage, parseArguments, resultText, streamUsage, type StepUsageState } from './json-stream.ts'
import { createTuiRenderer, type TuiSink } from './tui-renderer.ts'

/** Tunables for {@link projectTuiRun}; every field defaults. */
export interface TuiProjectionOptions {
  /** Terminal columns the layout wraps at; defaults to 80. */
  width?: number | undefined
  /** Emit ANSI color; defaults to false. */
  color?: boolean | undefined
  /** Animate the status line in place; defaults to false. */
  animate?: boolean | undefined
  /** Current time in milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Create the spinner timer and return its stop function; defaults to an 80 ms interval. */
  ticker?: ((redraw: () => void) => () => void) | undefined
  /** Skip the header banner on begin; useful for multi-turn interactive sessions. */
  skipHeader?: boolean | undefined
}

/** The live handle of one TUI projection. */
export interface TuiProjection {
  /** Print the summary footer from the run's final turn outcome. */
  finish(reason: TurnEndReason | undefined): void
  /** Print the failure footer from one runner error message. */
  fail(message: string): void
  /** Stop observing the Agent without a footer. */
  dispose(): void
}

/** Argument keys a tool summary prefers, in order. */
const SUMMARY_KEYS = [
  'file_path', 'path', 'command', 'pattern', 'query', 'url',
  'text', 'prompt', 'description', 'dir', 'directory', 'name', 'code',
]

/**
 * Summarize one tool call's raw arguments for its card line: the first
 * preferred string field, else the first string field, else compact JSON.
 * @param raw - the model's raw JSON argument string.
 * @returns the summary, empty when the arguments carry no displayable value.
 */
function toolSummary(raw: string): string {
  const args = parseArguments(raw)
  if (typeof args === 'string') return args
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ''
  const record = args as Record<string, unknown>
  for (const key of SUMMARY_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value !== '') return value
  }
  const serialized = JSON.stringify(args)
  return serialized === '{}' ? '' : serialized
}

/** The label the footer reports for one final turn outcome. */
function reasonLabel(reason: TurnEndReason | undefined): string {
  if (reason === undefined) return 'no turn completed'
  const kind = reason.kind
  switch (kind) {
    case 'completed':
      return 'completed'
    case 'aborted':
      return 'aborted'
    case 'blocked':
      return 'blocked'
    case 'error':
      return `${reason.error.code}: ${reason.error.message}`
    case 'max-tokens':
      return 'max tokens reached'
    case 'interrupted':
      return 'interrupted'
    case 'forked':
      return 'forked'
    /* v8 ignore next 2 -- TurnEndReasonMap is merge-extensible; a later kind renders its tag. */
    default:
      return kind
  }
}

/**
 * Project one run as the live terminal layout on `sink`. Subscribe before the
 * task is sent, like the JSON projection; the header prints immediately.
 * @param ctx - plugin context carrying the Agent's events.
 * @param agent - the Agent whose run is projected.
 * @param sink - the stdout sink the layout writes to.
 * @param info - header facts: session, provider route, model, and cwd.
 * @param options - width, color, animation, clock, and spinner timer.
 * @returns the projection handle.
 */
export function projectTuiRun(
  ctx: Context,
  agent: Agent,
  sink: TuiSink,
  info: { sessionId: string; provider: string; model: string; cwd?: string | undefined },
  options: TuiProjectionOptions = {},
): TuiProjection {
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const renderer = createTuiRenderer(sink, {
    width: options.width,
    color: options.color,
    animate: options.animate,
    skipHeader: options.skipHeader,
    now,
    ticker: options.ticker,
  })
  let disposed = false
  let usage: StepUsageState = { usage: undefined, complete: true }
  let steps = 0
  let tools = 0
  let toolErrors = 0
  let streamedText = false
  let streamedReasoning = false
  const callTimes = new Map<string, number>()

  const onFrame = (payload: { agent: Agent; frame: AssistantStreamFrame }): void => {
    if (payload.agent !== agent) return
    const { frame } = payload
    if (frame.type === 'start') {
      streamedText = false
      streamedReasoning = false
      renderer.setPhase('thinking')
      return
    }
    if (frame.type === 'end') {
      // The durable settlement (assistant/message or assistant/attempt) owns
      // its visible follow-up, so the frame end only closes the live section;
      // a live abandonment settles nowhere, so it notes itself here.
      renderer.flushStream('reasoning')
      renderer.flushStream('answer')
      if (frame.outcome.kind === 'abandoned') {
        renderer.note('attempt interrupted')
      }
      renderer.setPhase('thinking')
      return
    }
    const chunk = frame.chunk
    switch (chunk.type) {
      case 'block-start':
        return
      case 'block-end':
        return
      case 'text-delta':
        if (chunk.text === '') return
        streamedText = true
        renderer.answer(chunk.text)
        renderer.setPhase('answering')
        return
      case 'reasoning-delta':
        if (chunk.text === '') return
        streamedReasoning = true
        renderer.reasoning(chunk.text)
        renderer.setPhase('thinking')
        return
      case 'tool-call-delta':
        if (chunk.name !== undefined) renderer.setPhase(`running ${chunk.name}`)
        return
      case 'usage':
        return
      case 'finish':
        return
      /* v8 ignore next 2 -- StreamChunk is a closed union; this is its exhaustiveness guard. */
      default:
        return assertNever(chunk, 'assistant stream chunk')
    }
  }

  const onSessionEvent = (session: unknown, event: SessionEvent): void => {
    if (session !== agent.session) return
    switch (event.type) {
      case 'turn/start':
        renderer.setPhase('thinking')
        return
      case 'step/start':
        streamedText = false
        streamedReasoning = false
        return
      case 'step/end':
        steps += 1
        return
      case 'assistant/attempt':
        // A failed, retried, or cancelled attempt: its billed tokens live
        // only in the stream, and the reader deserves the note.
        usage = addUsage(usage, streamUsage(event.data.stream))
        renderer.note('attempt interrupted')
        renderer.setPhase('thinking')
        return
      case 'assistant/message': {
        usage = addUsage(usage, event.data.usage ?? streamUsage(event.data.stream))
        let text = ''
        let reasoning = ''
        for (const block of event.data.message.content) {
          if (block.type === 'text') text += block.text
          else if (block.type === 'reasoning') reasoning += block.text
        }
        if (reasoning.trim() !== '' && !streamedReasoning) {
          renderer.reasoning(reasoning)
          renderer.flushStream('reasoning')
        }
        if (text.trim() !== '' && !streamedText) {
          renderer.answer(text)
          renderer.flushStream('answer')
        }
        return
      }
      case 'tool/call':
        tools += 1
        callTimes.set(event.data.callId, event.time)
        renderer.toolStart(event.data.name, toolSummary(event.data.arguments))
        renderer.setPhase(`running ${event.data.name}`)
        return
      case 'tool/result': {
        if (event.surfaceOp !== 'append') return
        const message = event.data.message
        if (message.isError === true) toolErrors += 1
        const startedAt = callTimes.get(message.toolCallId)
        callTimes.delete(message.toolCallId)
        renderer.toolResult({
          ok: message.isError !== true,
          durationMs: startedAt === undefined ? undefined : Math.max(0, event.time - startedAt),
          text: resultText(message.content),
        })
        renderer.setPhase('thinking')
        return
      }
      default:
        return
    }
  }

  renderer.begin({ sessionId: info.sessionId, provider: info.provider, model: info.model, cwd: info.cwd })

  const stopFrame = ctx.on('agent/assistant-stream', onFrame)
  const stopSession = ctx.on('session/event', onSessionEvent)

  const stop = (): void => {
    if (disposed) return
    disposed = true
    stopFrame()
    stopSession()
  }

  return {
    finish(reason: TurnEndReason | undefined): void {
      if (disposed) return
      stop()
      renderer.finish({
        ok: reason?.kind === 'completed',
        label: reasonLabel(reason),
        elapsedMs: Math.max(0, now() - startedAt),
        steps,
        tools,
        toolErrors,
        usage: usage.usage,
        usageComplete: usage.complete,
      })
    },
    fail(message: string): void {
      if (disposed) return
      stop()
      renderer.fail(message)
    },
    dispose: stop,
  }
}
