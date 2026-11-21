/**
 * The IDE's column separators: the draggable edges between the three columns.
 *
 * An IDE whose columns are welded shut is a screenshot, not a workbench. Each
 * separator drags ONE column's width — the tree's or the assistant's — and
 * the middle column takes the rest, so the code never gets squeezed out.
 *
 * The drag is pointer-based and captured: the pointer may leave the separator
 * mid-drag, and the width still follows it until the button is released.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import css from './IdeWorkspace.module.css'

/** The props the separator renders from. */
export interface IdeSplitterProps {
  /**
   * Which edge this separator sits on.
   *
   * `start` is the tree's right edge: dragging it right widens the tree.
   * `end` is the assistant's left edge: dragging it left widens the
   * assistant.
   */
  readonly side: 'start' | 'end'
  /** The width the column currently has. */
  readonly width: number
  /** The narrowest the column may become. */
  readonly min: number
  /** The widest the column may become. */
  readonly max: number
  /** Report the new width while the pointer moves. */
  readonly onResize: (width: number) => void
  /** The accessible name of the separator. */
  readonly ariaLabel: string
  /** The separator's content, normally nothing. */
  readonly children?: ReactNode
}

/**
 * Keep a width inside its bounds.
 * @param width - the wanted width.
 * @param min - the narrowest allowed width.
 * @param max - the widest allowed width.
 * @returns the clamped width.
 */
function clamp(width: number, min: number, max: number): number {
  return Math.min(Math.max(width, min), max)
}

/**
 * Render a column separator.
 * @param props - the side, the current width, and the resize callback.
 * @returns the separator.
 */
export function IdeSplitter(props: IdeSplitterProps): ReactNode {
  const { side, width, min, max, onResize, ariaLabel, children } = props
  // A drag that outlives the component must stop touching the DOM.
  const endDrag = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => { endDrag.current?.() }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Only the primary button drags; a context menu must still open.
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const onMove = (move: PointerEvent): void => {
      const delta = side === 'start' ? move.clientX - startX : startX - move.clientX
      onResize(clamp(startWidth + delta, min, max))
    }
    const onUp = (): void => {
      target.releasePointerCapture(event.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      endDrag.current = undefined
    }
    endDrag.current?.()
    endDrag.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      className={css.splitter}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        // The keyboard moves the column too: 16px per press, 64px with shift.
        const step = event.shiftKey ? 64 : 16
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onResize(clamp(width - step, min, max))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onResize(clamp(width + step, min, max))
        }
      }}
    >
      {children}
    </div>
  )
}
