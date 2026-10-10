/**
 * The one-shot run's live terminal renderer: it draws a bordered header card,
 * a spinner status line, dimmed reasoning, compact tool cards, the streaming
 * answer, and a closing summary footer onto a text sink. It owns the in-place
 * status redraw (a carriage-return clear-and-rewrite) so the spinner never
 * fights the scrolling transcript. The renderer is pure — no process access —
 * so its clock, width, color, and spinner timer are all injected.
 * @module @deepseek-ai/dsh-headless/tui-renderer
 */

import type { StepUsage } from './json-stream.ts'

/** The text sink the renderer writes its layout to. */
export interface TuiSink {
  /** Write one chunk of the layout. */
  write(chunk: string): unknown
}

/** Facts the header card reports about the run. */
export interface TuiRunInfo {
  /** The Session identity the run drives. */
  sessionId: string
  /** The provider route the run uses. */
  provider: string
  /** The model the run uses. */
  model: string
  /** The working directory the run records; the header omits it when absent. */
  cwd?: string | undefined
}

/** One committed tool result's footer facts. */
export interface TuiToolResult {
  /** Whether the tool call completed cleanly. */
  ok: boolean
  /** Elapsed milliseconds between the call and its result, if both were observed. */
  durationMs?: number | undefined
  /** The result's model-facing text, for its size and a one-line error preview. */
  text: string
}

/** The closing footer's facts. */
export interface TuiFinishSummary {
  /** Whether the final turn completed. */
  ok: boolean
  /** A short outcome label, e.g. `completed`, `aborted`, or an error code line. */
  label: string
  /** Elapsed milliseconds for the whole run. */
  elapsedMs: number
  /** Steps the run closed. */
  steps: number
  /** Tool calls the run committed. */
  tools: number
  /** Tool calls that failed. */
  toolErrors: number
  /** Run-level token usage; the footer omits the count when absent or incomplete. */
  usage?: StepUsage | undefined
  /** False when any attempt omitted a usage sample, so the count must not be shown as exact. */
  usageComplete: boolean
}

/** Tunables for {@link createTuiRenderer}; every field defaults. */
export interface TuiRendererOptions {
  /** Terminal columns the layout wraps at; values below {@link MIN_WIDTH} clamp up. */
  width?: number | undefined
  /** Emit ANSI color. */
  color?: boolean | undefined
  /** Animate the status line in place (a real TTY); otherwise emit plain lines. */
  animate?: boolean | undefined
  /** Current time in milliseconds; the elapsed-time source. */
  now?: () => number
  /**
   * Create the spinner timer: receive a redraw callback, return its stop
   * function. Defaults to an 80 ms `setInterval`.
   */
  ticker?: ((redraw: () => void) => () => void) | undefined
  /** Skip the header banner on begin; useful for multi-turn interactive sessions. */
  skipHeader?: boolean | undefined
}

/** Narrowest terminal the layout supports; wider terminals use their own width. */
export const MIN_WIDTH = 40

/** Spinner frames cycled by the status line while a phase is active. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** The live status-line handle. */
export interface TuiRenderer {
  /** Print the header card and start the first status line. */
  begin(info: TuiRunInfo): void
  /** Set the active phase label; refreshes the status line. */
  setPhase(label: string): void
  /** Append live reasoning text; complete lines render as they form. */
  reasoning(delta: string): void
  /** Append live answer text; complete lines render as they form. */
  answer(delta: string): void
  /** Settle one live stream, emitting its unterminated tail, if any. */
  flushStream(kind: 'reasoning' | 'answer'): void
  /** Report a tool call as it commits, with a compact argument summary. */
  toolStart(name: string, summary: string): void
  /** Report a committed tool result under its call. */
  toolResult(result: TuiToolResult): void
  /** Print a neutral note line, e.g. an interrupted attempt. */
  note(text: string): void
  /** Print the closing summary footer and stop the spinner. */
  finish(summary: TuiFinishSummary): void
  /** Print an error footer and stop the spinner. */
  fail(message: string): void
  /** Stop the spinner, flush nothing, and ignore later calls. */
  dispose(): void
}

/** Carriage-return clear-line used to rewrite the status line in place. */
const REDRAW = '\r\x1b[2K'

/** Paint `text` with `code` when color is on. */
function paint(color: boolean, code: string, text: string): string {
  return color ? `${code}${text}\x1b[0m` : text
}

/** Whether a code point renders two columns wide in a typical terminal. */
function isWideCode(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd)
}

/** Display width of a string, counting East-Asian wide characters as two columns. */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    /* v8 ignore next 1 -- a string iterator never yields an empty segment, so the nullish fallback is unreachable. */
    width += isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
  }
  return width
}

/**
 * Wrap `text` into lines of at most `width` display columns, breaking on
 * whitespace; a single word wider than the line is hard-broken by character.
 * @param text - the source text.
 * @param width - the maximum display columns per line.
 * @returns the wrapped lines, without trailing newlines.
 */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const rawWord of rawLine.split(' ')) {
      if (rawWord === '') continue
      let word = rawWord
      const candidate = current === '' ? word : `${current} ${word}`
      if (displayWidth(candidate) <= width) {
        current = candidate
        continue
      }
      if (current !== '') lines.push(current)
      while (displayWidth(word) > width) {
        let cut = 1
        while (cut < word.length && displayWidth(word.slice(0, cut + 1)) <= width) cut += 1
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      current = word
    }
    lines.push(current)
  }
  return lines
}

/**
 * Truncate `text` to at most `width` display columns, adding an ellipsis when
 * something was dropped.
 * @param text - the source text.
 * @param width - the maximum display columns.
 * @returns the possibly-truncated text.
 */
function clip(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let out = ''
  let used = 0
  for (const char of text) {
    /* v8 ignore next 1 -- a string iterator never yields an empty segment, so the nullish fallback is unreachable. */
    const charWidth = isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
    if (used + charWidth > width - 1) break
    out += char
    used += charWidth
  }
  return `${out}…`
}

/** Format elapsed milliseconds as a compact human duration. */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds % 60)} s`
}

/** Format a byte count as a compact human size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Format a token count compactly, e.g. `1.2k`. */
function formatTokens(count: number): string {
  if (count < 1000) return `${count}`
  const thousands = count / 1000
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`
}

/** The first non-empty line of a multi-line text, for a one-line preview. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') return line.trim()
  }
  return ''
}

/**
 * Print the CetusPrism header banner card to a sink.
 * @param sink - the text sink the layout writes to.
 * @param info - header facts: session, provider, model, and cwd.
 * @param options - layout width and ANSI color options.
 */
export function printBanner(
  sink: TuiSink,
  info: TuiRunInfo,
  options: { width?: number | undefined; color?: boolean | undefined } = {},
): void {
  const width = Math.max(MIN_WIDTH, Math.floor(options.width ?? 80))
  const color = options.color === true
  const inner = width - 3
  const model = clip(`${info.provider}/${info.model}`, Math.max(0, inner - 14))
  const title = `◆ CetusPrism  ${model}`
  const session = clip(info.sessionId, 24)
  const cwd = info.cwd === undefined
    ? undefined
    : clip(info.cwd, Math.max(0, inner - displayWidth(session) - 3))
  const meta = cwd === undefined ? session : `${session}   ${cwd}`
  const border = (left: string, right: string): string =>
    paint(color, '\x1b[2m', `${left}${'─'.repeat(width - 2)}${right}`)
  const boxLine = (shown: string, painted: string): string => {
    const pad = Math.max(0, inner - displayWidth(shown))
    return `${paint(color, '\x1b[2m', '│')} ${painted}${' '.repeat(pad)}${paint(color, '\x1b[2m', '│')}`
  }
  sink.write(`${border('╭', '╮')}\n`)
  sink.write(`${boxLine(clip(title, inner), `${paint(color, '\x1b[1m', '◆ CetusPrism')}  ${paint(color, '\x1b[36m', model)}`)}\n`)
  sink.write(`${boxLine(
    clip(meta, inner),
    cwd === undefined
      ? session
      : `${session}   ${paint(color, '\x1b[2m', cwd)}`,
  )}\n`)
  sink.write(`${border('╰', '╯')}\n`)
}

/**
 * Create the live renderer over one sink.
 * @param sink - the text sink the layout writes to.
 * @param options - width, color, animation, clock, and spinner timer.
 * @returns the renderer handle driving one run.
 */
export function createTuiRenderer(sink: TuiSink, options: TuiRendererOptions = {}): TuiRenderer {
  const width = Math.max(MIN_WIDTH, Math.floor(options.width ?? 80))
  const color = options.color === true
  const animate = options.animate === true
  const now = options.now ?? (() => Date.now())
  const gutter = 2
  const code = {
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
  }

  let disposed = false
  let startedAt = 0
  let frame = 0
  let phase = 'starting'
  let statusLive = false
  let stopTicker: (() => void) | undefined
  let reasoningBuffer = ''
  let answerBuffer = ''

  /** Write one chunk; every call site runs only before a terminal state. */
  const write = (chunk: string): void => {
    sink.write(chunk)
  }

  /** The dim full-width rule the footer sits under. */
  const rule = (): string => paint(color, code.dim, '─'.repeat(width))

  /** Clear the in-place status line, leaving the cursor at its start. */
  const settleStatus = (): void => {
    if (!statusLive) return
    if (animate) write(`${REDRAW}\n`)
    statusLive = false
  }

  /** Emit one transcript line, settling the status line first. */
  const emitLine = (line: string): void => {
    settleStatus()
    write(`${line}\n`)
  }

  /** Draw the status line: in place when animating, as a plain line otherwise. */
  const drawStatus = (): void => {
    if (disposed) return
    const spinner = animate ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length] : '•'
    const elapsed = startedAt === 0 ? '' : ` ${formatElapsed(now() - startedAt)}`
    const text = paint(color, code.dim, `${spinner} ${phase}${elapsed}`)
    if (!animate) {
      write(`${text}\n`)
      statusLive = true
      return
    }
    if (statusLive) write(REDRAW)
    write(text)
    statusLive = true
  }

  const startTicker = (): void => {
    if (stopTicker !== undefined) return
    const redraw = (): void => {
      frame += 1
      drawStatus()
    }
    stopTicker = options.ticker?.(redraw) ?? ((tick: () => void) => {
      const id = setInterval(tick, 80)
      return () => clearInterval(id)
    })(redraw)
  }

  const stopTickerNow = (): void => {
    stopTicker?.()
    stopTicker = undefined
  }

  /** The reasoning gutter: two spaces, a dim rail, one space. */
  const reasoningLine = (line: string): string =>
    `${' '.repeat(gutter)}${paint(color, code.dim, `│ ${line}`)}`

  /** The answer line: the gutter of plain spaces. */
  const answerLine = (line: string): string =>
    `${' '.repeat(gutter)}${line}`

  /** Flush one buffered stream's complete lines, keeping the tail pending. */
  const flushComplete = (kind: 'reasoning' | 'answer'): void => {
    const buffer = kind === 'reasoning' ? reasoningBuffer : answerBuffer
    const lastBreak = buffer.lastIndexOf('\n')
    const complete = lastBreak === -1 ? '' : buffer.slice(0, lastBreak)
    const rest = lastBreak === -1 ? buffer : buffer.slice(lastBreak + 1)
    if (kind === 'reasoning') reasoningBuffer = rest
    else answerBuffer = rest
    if (complete === '') return
    const budget = kind === 'reasoning' ? width - gutter - 2 : width - gutter
    const render = kind === 'reasoning' ? reasoningLine : answerLine
    for (const line of wrap(complete, budget)) emitLine(render(line))
  }

  /** Emit a buffered stream's remaining tail, if any. */
  const emitTail = (kind: 'reasoning' | 'answer'): void => {
    const buffer = kind === 'reasoning' ? reasoningBuffer : answerBuffer
    if (buffer === '') return
    if (kind === 'reasoning') reasoningBuffer = ''
    else answerBuffer = ''
    const budget = kind === 'reasoning' ? width - gutter - 2 : width - gutter
    const render = kind === 'reasoning' ? reasoningLine : answerLine
    for (const line of wrap(buffer, budget)) emitLine(render(line))
  }

  return {
    begin(info: TuiRunInfo): void {
      if (disposed) return
      startedAt = now()
      if (options.skipHeader !== true) {
        printBanner(sink, info, { width, color })
        emitLine('')
      }
      drawStatus()
      if (animate) startTicker()
    },

    setPhase(label: string): void {
      if (disposed || label === phase) return
      phase = label
      drawStatus()
    },

    reasoning(delta: string): void {
      if (disposed || delta === '') return
      reasoningBuffer += delta
      flushComplete('reasoning')
    },

    answer(delta: string): void {
      if (disposed || delta === '') return
      answerBuffer += delta
      flushComplete('answer')
    },

    flushStream(kind: 'reasoning' | 'answer'): void {
      if (disposed) return
      emitTail(kind)
    },

    toolStart(name: string, summary: string): void {
      if (disposed) return
      emitTail('reasoning')
      emitTail('answer')
      const clipped = clip(name, 24)
      const rest = Math.max(0, width - gutter - 1 - 1 - displayWidth(clipped) - 2)
      const label = `${' '.repeat(gutter)}${paint(color, code.magenta, '◈')} ${paint(color, code.bold, clipped)}`
      const shown = summary === '' || rest === 0 ? '' : `  ${paint(color, code.dim, clip(summary, rest))}`
      emitLine(`${label}${shown}`)
    },

    toolResult(result: TuiToolResult): void {
      if (disposed) return
      const icon = result.ok ? paint(color, code.green, '✓') : paint(color, code.red, '✗')
      const facts: string[] = []
      if (result.durationMs !== undefined) facts.push(formatElapsed(result.durationMs))
      facts.push(formatBytes(Buffer.byteLength(result.text, 'utf8')))
      const preview = result.ok
        ? ''
        : `  ${paint(color, code.dim, clip(firstLine(result.text), width - gutter - 16))}`
      emitLine(`${' '.repeat(gutter)}  ${icon} ${paint(color, code.dim, facts.join(' · '))}${preview}`)
    },

    note(text: string): void {
      if (disposed) return
      emitTail('reasoning')
      emitTail('answer')
      for (const line of wrap(text, width - gutter - 2)) {
        emitLine(`${' '.repeat(gutter)}${paint(color, code.yellow, `· ${line}`)}`)
      }
    },

    finish(summary: TuiFinishSummary): void {
      if (disposed) return
      stopTickerNow()
      emitTail('reasoning')
      emitTail('answer')
      settleStatus()
      emitLine(rule())
      const icon = summary.ok ? paint(color, code.green, '✓') : paint(color, code.red, '✗')
      const parts: string[] = [summary.label, formatElapsed(summary.elapsedMs)]
      if (summary.steps > 0) parts.push(`${summary.steps} step${summary.steps === 1 ? '' : 's'}`)
      if (summary.tools > 0) {
        parts.push(`${summary.tools} tool${summary.tools === 1 ? '' : 's'}`)
        if (summary.toolErrors > 0) parts.push(paint(color, code.red, `${summary.toolErrors} failed`))
      }
      if (summary.usage !== undefined && summary.usageComplete) {
        const usage = summary.usage
        const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        parts.push(`${formatTokens(input)} in / ${formatTokens(usage.outputTokens)} out`)
      }
      emitLine(`${icon} ${parts.join('  ·  ')}`)
      disposed = true
    },

    fail(message: string): void {
      if (disposed) return
      stopTickerNow()
      emitTail('reasoning')
      emitTail('answer')
      settleStatus()
      emitLine(rule())
      emitLine(`${paint(color, code.red, '✗')} ${paint(color, code.red, clip(message, width - 2))}`)
      disposed = true
    },

    dispose(): void {
      stopTickerNow()
      disposed = true
    },
  }
}
