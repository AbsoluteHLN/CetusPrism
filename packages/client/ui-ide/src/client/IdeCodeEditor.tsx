/**
 * The IDE's code surface: an editable source view.
 *
 * The surface is a TEXT AREA over a highlighted layer, not the product's
 * read-only code card: the file is the user's to edit, and the editor owes
 * them the three things a code surface must get right.
 *
 * - The text does not WRAP. A source line is a line; a narrow column scrolls
 *   sideways instead of breaking a word in half.
 * - The line numbers do not clip. The gutter is as wide as the file's own
 *   line count needs, and it scrolls with the text.
 * - The code fills the column. There is no floating card inside the pane and
 *   no margin around the text: the pane IS the code.
 *
 * The highlighted layer is the same grammar the rest of the product uses, and
 * it is drawn behind a transparent text area: the browser's own caret,
 * selection and undo stack stay in charge of the text.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useCodeHighlighter } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './IdeWorkspace.module.css'

/** The props of the code surface. */
export interface IdeCodeEditorProps {
  /** The file's text. */
  readonly content: string
  /** The syntax language; empty means plain text. */
  readonly language: string
  /** Whether the text may be edited. */
  readonly readOnly?: boolean
  /** The editor's own edit. */
  readonly onChange: (content: string) => void
  /** Write the file back to disk. */
  readonly onSave: () => void
  /** The caret's position, for the status bar. */
  readonly onCursor?: (line: number, column: number) => void
  /** The surface's accessible label. */
  readonly ariaLabel: string
}

/** Spaces one Tab inserts; the surface keeps the caret inside the text. */
const INDENT = '  '

/**
 * The caret's line and column, 1-based on both axes.
 * @param text - the file's text.
 * @param offset - the caret's offset in the text.
 * @returns the line and the column.
 */
export function cursorPosition(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, clamped)
  const lines = before.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

/**
 * Render the IDE's code surface.
 * @param props - the file's text, the language, and the edit/save verbs.
 * @returns the editable code surface.
 */
export function IdeCodeEditor(props: IdeCodeEditorProps): ReactNode {
  const { content, language, readOnly = false, onChange, onSave, onCursor, ariaLabel } = props
  const highlight = useCodeHighlighter(language === '' ? undefined : language)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const layerRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => content.split('\n'), [content])
  const highlighted = useMemo(() => highlight(content), [highlight, content])

  // The scroll offsets live in the DOM, not in state: a scroll must not
  // re-render the file. The highlighted layer follows the text area's scroll,
  // and the gutter follows its vertical half.
  const syncScroll = useCallback(() => {
    const input = inputRef.current
    if (input === null) return
    if (layerRef.current !== null) {
      layerRef.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`
    }
    if (gutterRef.current !== null) {
      gutterRef.current.style.transform = `translateY(${-input.scrollTop}px)`
    }
  }, [])

  const reportCursor = useCallback(() => {
    if (onCursor === undefined) return
    const input = inputRef.current
    if (input === null) return
    const { line, column } = cursorPosition(input.value, input.selectionStart)
    onCursor(line, column)
  }, [onCursor])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Save is the editor's own gesture, and it must not reach the browser.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      onSave()
      return
    }
    // Tab indents instead of leaving the surface: a code surface that
    // swallows the caret on Tab is unusable with a keyboard.
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const input = event.currentTarget
      const { selectionStart, selectionEnd } = input
      const next = `${content.slice(0, selectionStart)}${INDENT}${content.slice(selectionEnd)}`
      onChange(next)
      // The caret lands after the inserted indent, once the value settles.
      requestAnimationFrame(() => {
        input.selectionStart = selectionStart + INDENT.length
        input.selectionEnd = selectionStart + INDENT.length
      })
    }
  }, [content, onChange, onSave])

  const body = highlighted === undefined
    ? lines.map((line, index) => (
      <span key={index} className={css.codeLine}>{line}</span>
    ))
    : highlighted.map((line, index) => (
      <span key={index} className={css.codeLine}>
        {line.map((span, spanIndex) => <span key={spanIndex} style={span.style}>{span.text}</span>)}
      </span>
    ))

  useLayoutEffect(() => {
    syncScroll()
    reportCursor()
  }, [content, syncScroll, reportCursor])

  return (
    <div className={css.codeEditor} data-ide-editor="">
      <div className={css.gutter} aria-hidden="true" data-ide-gutter="">
        <div className={css.gutterInner} ref={gutterRef}>
          {lines.map((_, index) => (
            <span key={index} className={css.gutterLine}>{index + 1}</span>
          ))}
        </div>
      </div>
      <div className={css.codeSurface}>
        <pre className={css.codeLayer} ref={layerRef} aria-hidden="true" data-ide-code-layer=""><code>{body}</code></pre>
        <textarea
          ref={inputRef}
          className={css.codeInput}
          value={content}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          aria-label={ariaLabel}
          onChange={(event) => { onChange(event.target.value) }}
          onScroll={syncScroll}
          onSelect={reportCursor}
          onKeyUp={reportCursor}
          onClick={reportCursor}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}
