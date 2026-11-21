// @vitest-environment jsdom

/**
 * The IDE's code surface: an editable source view.
 *
 * The surface owes the user three things a code view must get right: the text
 * does not wrap, the line numbers do not clip, and the file can be changed
 * and written back.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { IdeCodeEditor, cursorPosition } from '../src/client/IdeCodeEditor.tsx'

afterEach(cleanup)

/**
 * Render the surface over one file.
 * @param overrides - the props to change.
 * @returns the spies the surface reports through.
 */
function surface(overrides: {
  content?: string
  language?: string
} = {}): {
  onChange: Mock<(content: string) => void>
  onSave: Mock<() => void>
  onCursor: Mock<(line: number, column: number) => void>
} {
  const onChange = vi.fn<(content: string) => void>()
  const onSave = vi.fn<() => void>()
  const onCursor = vi.fn<(line: number, column: number) => void>()
  render(
    <IdeCodeEditor
      content={overrides.content ?? 'const a = 1\nconst b = 2\n'}
      language={overrides.language ?? ''}
      onChange={onChange}
      onSave={onSave}
      onCursor={onCursor}
      ariaLabel="代码内容"
    />,
  )
  return { onChange, onSave, onCursor }
}

describe('the caret position of the IDE code surface', () => {
  it('is one-based on both axes', () => {
    expect(cursorPosition('one\ntwo', 0)).toEqual({ line: 1, column: 1 })
    expect(cursorPosition('one\ntwo', 3)).toEqual({ line: 1, column: 4 })
    expect(cursorPosition('one\ntwo', 4)).toEqual({ line: 2, column: 1 })
    expect(cursorPosition('one\ntwo', 7)).toEqual({ line: 2, column: 4 })
  })

  it('never walks past the text', () => {
    expect(cursorPosition('one', 99)).toEqual({ line: 1, column: 4 })
    expect(cursorPosition('one', -5)).toEqual({ line: 1, column: 1 })
  })
})

describe('the IDE code surface', () => {
  it('numbers every line of the file in the gutter', () => {
    surface({ content: 'a\nb\nc' })

    const numbers = document.querySelectorAll('[data-ide-gutter] span')
    expect(numbers.length).toBe(3)
    expect(numbers[0]?.textContent).toBe('1')
    expect(numbers[2]?.textContent).toBe('3')
  })

  it('hands every edit to the owner', () => {
    const { onChange } = surface({ content: 'a' })

    fireEvent.change(screen.getByLabelText('代码内容'), { target: { value: 'ab' } })

    expect(onChange).toHaveBeenCalledWith('ab')
  })

  it('saves on Ctrl+S and keeps the gesture from the browser', () => {
    const { onSave } = surface()

    const handled = fireEvent.keyDown(screen.getByLabelText('代码内容'), { key: 's', ctrlKey: true })

    expect(onSave).toHaveBeenCalledTimes(1)
    // A preventDefault reports as a cancelled event.
    expect(handled).toBe(false)
  })

  it('indents with Tab instead of leaving the surface', () => {
    const { onChange } = surface({ content: 'ab' })

    fireEvent.keyDown(screen.getByLabelText('代码内容'), { key: 'Tab' })

    expect(onChange).toHaveBeenCalledWith('  ab')
  })

  it('reports the caret position when the user moves it', () => {
    const { onCursor } = surface({ content: 'one\ntwo' })
    const code = screen.getByLabelText('代码内容') as HTMLTextAreaElement
    code.setSelectionRange(4, 4)

    fireEvent.click(code)

    expect(onCursor).toHaveBeenCalledWith(2, 1)
  })
})
