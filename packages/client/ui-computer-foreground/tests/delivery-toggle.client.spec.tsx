// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComputerDeliveryView, ComputerUseDeliveryMode } from '@deepseek-ai/dsh-computer-use-policy/client'
import { DeliveryToggle, type DeliveryToggleProps } from '../src/client/DeliveryToggle.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: DeliveryToggleProps['t'] = makeTranslate(zh)

function setup(options: {
  view?: ComputerDeliveryView | undefined
  locked?: boolean
  submit?: (mode: ComputerUseDeliveryMode) => Promise<boolean>
} = {}) {
  const store = createSnapshotStore<{ value: ComputerDeliveryView | undefined }>({
    value: 'view' in options ? options.view : { mode: 'allow-foreground' },
  })
  const useProjection = (_key: string, selector?: (value: unknown) => unknown) =>
    bindSnapshotSelector(store)(state => (selector ?? (value => value))(state.value))
  const submit = vi.fn(options.submit ?? (() => Promise.resolve(true)))
  const props = {
    locked: options.locked ?? false,
    useProjection,
    submit,
    t,
  } as unknown as DeliveryToggleProps
  const view = render(<DeliveryToggle {...props} />)
  return { props, submit, view }
}

describe('DeliveryToggle', () => {
  it('renders nothing when the host offers no delivery policy', () => {
    const missing = setup({ view: undefined })
    expect(missing.view.container.innerHTML).toBe('')
  })

  it('shows the allowed state and submits background-only on click', async () => {
    const settled = Promise.withResolvers<boolean>()
    const { submit } = setup({
      view: { mode: 'allow-foreground' },
      submit: () => settled.promise,
    })
    const toggle = screen.getByRole('button') as HTMLButtonElement
    expect(toggle.textContent).toBe('允许抢前台')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.title).toContain('后台通道')

    fireEvent.click(toggle)
    expect(submit).toHaveBeenCalledExactlyOnceWith('background-only')
    expect(toggle.disabled).toBe(true)
    settled.resolve(true)
  })

  it('shows the blocked state as pressed and submits allow-foreground on click', () => {
    const { submit } = setup({ view: { mode: 'background-only' } })
    const toggle = screen.getByRole('button', { pressed: true }) as HTMLButtonElement
    expect(toggle.textContent).toBe('禁止抢前台')
    fireEvent.click(toggle)
    expect(submit).toHaveBeenCalledExactlyOnceWith('allow-foreground')
  })

  it('stays inert while locked', () => {
    setup({ locked: true })
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })

  it('releases the pending lock after a failed submit', async () => {
    const { submit } = setup({
      submit: () => Promise.reject(new Error('switch failed')),
    })
    const toggle = screen.getByRole('button') as HTMLButtonElement
    fireEvent.click(toggle)
    await vi.waitFor(() => { expect(toggle.disabled).toBe(false) })
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
