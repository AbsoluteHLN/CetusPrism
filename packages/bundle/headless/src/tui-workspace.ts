/**
 * The full-screen workspace controller for a real terminal: it owns the
 * alternate-buffer layout and scroll region, while the parent owns readline.
 * The transcript accepts existing renderer output and tracks the logical
 * cursor through SGR sequences, CR, LF, and clear-line sequences.
 * @module @deepseek-ai/dsh-headless/tui-workspace
 */

import type { TuiSink } from './tui-renderer.ts'

/** Facts the fixed header and footer report about the live workspace. */
export interface TuiWorkspaceStatus {
  /** The Session identity the workspace drives. */
  sessionId: string
  /** The provider route the workspace uses. */
  provider: string
  /** The model the workspace uses. */
  model: string
  /** The working directory the workspace records. */
  cwd: string
  /** Whether a turn is active. */
  busy: boolean
}

/** The terminal screen controller over one text sink. */
export interface TuiWorkspace {
  /** Append one renderer-produced transcript chunk to the scrolling region. */
  write(chunk: string): unknown
  /** Redraw the fixed header and footer from the latest status. */
  update(status: TuiWorkspaceStatus): void
  /** Apply a terminal resize and redraw the fixed rows. */
  resize(columns: number, rows: number): void
  /** Move the terminal cursor to the input row and return the readline prompt. */
  inputPrompt(): string
  /** Restore the terminal and ignore later calls. */
  dispose(): void
}

/** Two header rows, two transcript rows, and four footer/input rows. */
const FULL_SCREEN_ROWS = 8

/** The readable prompt glyph returned for readline. */
const PROMPT = '❯ '

/** The single DEC saved-cursor slot used by every public operation. */
const SAVE_CURSOR = '\x1b7'

/** Restore the single DEC saved-cursor slot. */
const RESTORE_CURSOR = '\x1b8'

/** Whether a code point commonly renders two terminal columns wide. */
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

/** Display width of text, counting East-Asian wide characters as two columns. */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    /* v8 ignore next 1 -- a string iterator never yields an empty segment. */
    width += isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
  }
  return width
}

/** Clip sanitized text to a display-column width, adding an ellipsis when cut. */
function clipText(text: string, width: number): string {
  const safe = sanitize(text)
  if (displayWidth(safe) <= width) return safe
  let out = ''
  let used = 0
  for (const char of safe) {
    /* v8 ignore next 1 -- a string iterator never yields an empty segment. */
    const charWidth = isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1
    if (used + charWidth > width - 1) break
    out += char
    used += charWidth
  }
  return `${out}…`
}

/** Remove terminal escape sequences and control characters from status text. */
function sanitize(text: string): string {
  return text
    .replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
    .split('')
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)
    })
    .join('')
}

/** Pad a clipped line to the terminal width using display-column arithmetic. */
function padLine(text: string, width: number): string {
  const shown = clipText(text, width)
  return `${shown}${' '.repeat(Math.max(0, width - displayWidth(shown)))}`
}

/** Move the terminal cursor to a one-based row and column. */
function moveTo(row: number, column: number): string {
  return `\x1b[${row};${column}H`
}

/**
 * Advance the transcript cursor through one renderer chunk.
 * @param chunk - the renderer chunk.
 * @param startColumn - the zero-based column before the chunk.
 * @param columns - the terminal width.
 * @returns normalized terminal text and its final zero-based column.
 */
function advanceChunk(chunk: string, startColumn: number, columns: number): { text: string; column: number } {
  let column = startColumn
  let text = ''
  for (let index = 0; index < chunk.length;) {
    const code = chunk.codePointAt(index) ?? 0
    if (code === 0x1b && chunk[index + 1] === '[') {
      let end = index + 2
      while (end < chunk.length) {
        const sequenceCode = chunk.codePointAt(end) ?? 0
        if (sequenceCode >= 0x40 && sequenceCode <= 0x7e) break
        end += 1
      }
      const sequence = chunk.slice(index, end + 1)
      if (sequence.endsWith('m') || sequence.endsWith('K')) text += sequence
      index = end + 1
      continue
    }
    const char = String.fromCodePoint(code)
    if (char === '\r') { text += '\r'; column = 0 }
    else if (char === '\n') { text += '\r\n'; column = 0 }
    else if (char === '\t') {
      const spaces = Math.min(8 - column % 8, columns - column)
      text += ' '.repeat(spaces)
      column += spaces
    } else if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
      const width = /\p{Mark}/u.test(char) ? 0 : isWideCode(code) ? 2 : 1
      if (column + width > columns) { text += '\r\n'; column = 0 }
      text += char
      column += width
    }
    index += char.length
  }
  return { text, column }
}

/**
 * Create the full-screen controller over `sink`.
 * @param sink - the terminal text sink.
 * @param options - current columns, rows, and whether ANSI color is allowed.
 * @returns the workspace handle.
 */
export function createTuiWorkspace(
  sink: TuiSink,
  options: { columns: number; rows: number; color: boolean },
): TuiWorkspace {
  let columns = Math.max(1, Math.floor(options.columns))
  let rows = Math.max(1, Math.floor(options.rows))
  const color = options.color
  let disposed = false
  let transcriptCol = 0
  let status: TuiWorkspaceStatus = {
    sessionId: '',
    provider: '',
    model: '',
    cwd: '',
    busy: false,
  }

  /** Whether the current size supports the full-screen scroll-region layout. */
  const isFull = (): boolean => rows >= FULL_SCREEN_ROWS && columns >= 16

  /** Emit one raw terminal chunk. */
  const emit = (chunk: string): void => {
    sink.write(chunk)
  }

  /** Enter alternate screen, clear it, and set the transcript scroll region. */
  const enterScreen = (): void => {
    emit('\x1b[?1049h\x1b[H\x1b[2J')
    if (isFull()) emit(`\x1b[3;${rows - 4}r`)
  }

  /** Restore scroll margins, SGR state, and the primary buffer. */
  const leaveScreen = (): void => {
    emit('\x1b[r\x1b[m\x1b[?1049l')
  }

  /** Draw one padded fixed row without touching the readline input row. */
  const drawFixed = (row: number, text: string): void => {
    const style = color ? '\x1b[1m' : ''
    emit(`${moveTo(row, 1)}\x1b[2K${style}${padLine(text, columns)}${color ? '\x1b[0m' : ''}`)
  }

  /** Redraw the header, status footer, hints, and preserve the active cursor. */
  const drawChrome = (): void => {
    if (!isFull()) return
    const model = `${status.provider}/${status.model}`
    const meta = status.cwd === '' ? status.sessionId : `${status.sessionId}  ${status.cwd}`
    const busy = status.busy ? 'working' : 'ready'
    drawFixed(1, `CetusPrism  ${model}`)
    drawFixed(2, meta)
    drawFixed(rows - 3, busy)
    drawFixed(rows - 2, 'enter send · ctrl+d exit')
    drawFixed(rows, 'ctrl+c stop · /help commands')
    // Fixed-row drawing is wrapped by the caller's single save/restore pair.
  }

  /** Move to the input row without clearing or echoing the readline prompt. */
  const movePrompt = (): void => {
    emit(moveTo(rows - 1, 1))
  }

  if (isFull()) enterScreen()
  drawChrome()
  return {
    write(chunk: string): unknown {
      if (disposed || chunk === '') return undefined
      if (!isFull()) {
        emit(chunk)
      } else {
        emit(SAVE_CURSOR)
        emit(moveTo(rows - 4, Math.min(transcriptCol + 1, columns)))
        const advanced = advanceChunk(chunk, transcriptCol, columns)
        emit(advanced.text)
        transcriptCol = advanced.column
        emit(RESTORE_CURSOR)
      }
      return undefined
    },
    update(next: TuiWorkspaceStatus): void {
      if (disposed) return
      status = next
      if (!isFull()) return
      emit(SAVE_CURSOR)
      drawChrome()
      emit(RESTORE_CURSOR)
    },
    resize(nextColumns: number, nextRows: number): void {
      if (disposed) return
      const wasFull = isFull()
      if (wasFull) emit('\x1b[r')
      columns = Math.max(1, Math.floor(nextColumns))
      rows = Math.max(1, Math.floor(nextRows))
      transcriptCol = Math.min(transcriptCol, columns)
      if (isFull()) {
        if (!wasFull) {
          enterScreen()
        } else {
          emit(`\x1b[3;${rows - 4}r`)
        }
        drawChrome()
        return
      }
      if (wasFull) leaveScreen()
      transcriptCol = 0
    },
    inputPrompt(): string {
      if (disposed) return ''
      if (isFull()) { movePrompt(); emit('\x1b[2K') }
      return PROMPT
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (isFull()) leaveScreen()
    },
  }
}
