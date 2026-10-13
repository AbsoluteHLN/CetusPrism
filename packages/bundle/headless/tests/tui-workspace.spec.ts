import { describe, expect, it } from 'vitest'
import { createTuiWorkspace, type TuiWorkspaceStatus } from '../src/tui-workspace.ts'

interface Harness {
  readonly output: string[]
  readonly workspace: ReturnType<typeof createTuiWorkspace>
  readonly text: () => string
}

/** Capture controller output without introducing process globals. */
function createHarness(columns: number, rows: number): Harness {
  const output: string[] = []
  const workspace = createTuiWorkspace(
    { write(chunk: string): void { output.push(chunk) } },
    { columns, rows, color: false },
  )
  return { output, workspace, text: () => output.join('') }
}

const status: TuiWorkspaceStatus = {
  sessionId: 'session-1',
  provider: 'csu',
  model: 'deepseek',
  cwd: '/tmp/work',
  busy: true,
}

describe('tui workspace', () => {
  it('enters the alternate buffer and sets the scroll region', () => {
    const { text } = createHarness(40, 10)
    expect(text()).toContain('\x1b[?1049h')
    expect(text()).toContain('\x1b[3;6r')
    expect(text()).toContain('\x1b[2;1H')
  })

  it('moves to the input row without clearing or echoing it', () => {
    const { output, workspace } = createHarness(40, 10)
    const before = output.length
    expect(workspace.inputPrompt()).toBe('❯ ')
    expect(output[before]).toBe('\x1b[9;1H')
    expect(output.join('')).not.toContain('\x1b[2K\x1b[9;')
  })

  it('tracks transcript columns through SGR and CR/LF', () => {
    const { output, workspace } = createHarness(40, 10)
    const before = output.length
    workspace.write('\x1b[1mabc\rdef\nghi')
    expect(output[before]).toBe('\x1b7')
    expect(output[before + 1]).toBe('\x1b[6;1H')
    expect(output[before + 2]).toBe('\x1b[1mabc\rdef\r\nghi')
    workspace.write(' tail')
    expect(output.at(-3)).toBe('\x1b[6;4H')
  })

  it('clips multibyte status text without breaking a wide character', () => {
    const { output, workspace } = createHarness(16, 10)
    workspace.update({ ...status, cwd: '/路径/很长很长' })
    const meta = output.find((chunk) => chunk.includes('session-1'))
    expect(meta).toBeDefined()
    expect(meta).toContain('…')
  })

  it('updates the scroll region on resize', () => {
    const { output, workspace } = createHarness(40, 10)
    const before = output.length
    workspace.resize(20, 8)
    expect(output[before + 1]).toContain('\x1b[3;4r')
  })

  it('ignores transcript and status work after dispose', () => {
    const { output, workspace } = createHarness(40, 10)
    workspace.dispose()
    const count = output.length
    workspace.write('later')
    workspace.update(status)
    expect(workspace.inputPrompt()).toBe('')
    expect(output).toHaveLength(count)
  })

  it('uses inline output for tiny terminals and restores the primary buffer when shrinking', () => {
    const { text, workspace } = createHarness(40, 10)
    workspace.resize(10, 5)
    workspace.write('inline\n')
    expect(text()).toContain('\x1b[r\x1b[m\x1b[?1049l')
    const tiny = createHarness(10, 5)
    tiny.workspace.inputPrompt()
    tiny.workspace.dispose()
    expect(tiny.text()).toBe('')
  })

  it('wraps transcript across chunk boundaries and preserves the editing cursor', () => {
    const { output, workspace } = createHarness(16, 10)
    workspace.write('1234567890123456')
    workspace.write('next')
    expect(output.at(-2)).toBe('\r\nnext')
    const before = output.length
    workspace.update(status)
    expect(output[before]).toBe('\x1b7')
    expect(output.at(-1)).toBe('\x1b8')
  })
})
