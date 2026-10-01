// @vitest-environment jsdom
/** The per-model reasoning-effort declaration writes the profile schema's shapes. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelReasoningEfforts } from '../src/client/ModelReasoningEfforts.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: Parameters<Parameters<typeof ModelReasoningEfforts>[0]['t']>[0]) => en[key]

function renderRow(model: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void): void {
  render(
    <ModelReasoningEfforts
      model={model} position={1} disabled={false} t={t} onChange={onChange as never}
    />,
  )
}

const SELECT_LABEL = `${en.modelReasoning} 1`

describe('ModelReasoningEfforts', () => {
  it('renders as not-declared for a model without the field and deletes it on switching back', () => {
    const onChange = vi.fn()
    renderRow({ id: 'm1' }, onChange)
    const select = screen.getByLabelText(SELECT_LABEL) as HTMLSelectElement
    expect(select.value).toBe('inherit')
    fireEvent.change(select, { target: { value: 'custom' } })
    expect(onChange).toHaveBeenCalledWith({
      id: 'm1',
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    })
  })

  it('switching to inherit removes the field instead of storing an empty shape', () => {
    const onChange = vi.fn()
    renderRow({ id: 'm1', reasoningEfforts: false }, onChange)
    fireEvent.change(screen.getByLabelText(SELECT_LABEL), { target: { value: 'inherit' } })
    const firstCall = onChange.mock.calls[0]
    expect(firstCall).toBeDefined()
    const next = firstCall?.[0] as Record<string, unknown>
    expect(next).toEqual({ id: 'm1' })
    expect('reasoningEfforts' in next).toBe(false)
  })

  it('switching to none stores false', () => {
    const onChange = vi.fn()
    renderRow({ id: 'm1' }, onChange)
    fireEvent.change(screen.getByLabelText(SELECT_LABEL), { target: { value: 'none' } })
    expect(onChange).toHaveBeenCalledWith({ id: 'm1', reasoningEfforts: false })
  })

  it('custom mode checks levels into the dict, maps off to null, and unchecking the field removes its key', () => {
    const onChange = vi.fn()
    renderRow({ id: 'm1', reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } }, onChange)
    const xhigh = screen.getByLabelText(en.modelReasoningXhigh)
    fireEvent.click(xhigh)
    expect(onChange).toHaveBeenCalledWith({
      id: 'm1',
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    })
    // Unchecking a level drops only its key; unchecking `off` drops the null entry.
    const firstCall = onChange.mock.calls[0]
    expect(firstCall).toBeDefined()
    const dict = (firstCall?.[0] as Record<string, unknown>)['reasoningEfforts'] as Record<string, string | null>
    expect(dict['xhigh']).toBe('xhigh')
    fireEvent.click(screen.getByLabelText(en.modelReasoningOff))
    expect(onChange).toHaveBeenLastCalledWith({
      id: 'm1',
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
    })
  })

  it('keeps unrelated row fields when writing', () => {
    const onChange = vi.fn()
    renderRow({ id: 'm1', contextWindow: 131072 }, onChange)
    fireEvent.change(screen.getByLabelText(SELECT_LABEL), { target: { value: 'none' } })
    expect(onChange).toHaveBeenCalledWith({ id: 'm1', contextWindow: 131072, reasoningEfforts: false })
  })
})
