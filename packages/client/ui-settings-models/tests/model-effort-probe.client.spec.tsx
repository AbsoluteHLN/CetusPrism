// @vitest-environment jsdom
/** The per-model effort probe asks the endpoint and adopts the levels it accepts. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LlmReasoningEffortProbeResult } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import type { ProbeTarget } from '../src/client/ModelListEditor.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The levels one endpoint accepts, with the one it refused. */
function probed(overrides: Partial<LlmReasoningEffortProbeResult> = {}): LlmReasoningEffortProbeResult {
  return {
    accepted: ['off', 'low', 'high'],
    refused: [{ level: 'xhigh', detail: '400 unsupported value' }],
    declaration: { off: null, low: 'low', high: 'high' },
    outcomes: [
      { level: 'off', accepted: true },
      { level: 'low', accepted: true },
      { level: 'high', accepted: true },
      { level: 'xhigh', accepted: false, detail: '400 unsupported value' },
    ],
    ...overrides,
  }
}

/** The page operations, with the effort probe scripted. */
function operations(probe: ModelsOperations['probeReasoningEfforts']): ModelsOperations {
  return {
    discoverModels: vi.fn<ModelsOperations['discoverModels']>(
      () => Promise.resolve({ kind: 'found', models: [] }),
    ),
    probeReasoningEfforts: probe,
    describeCredential: vi.fn(),
    storeCredential: vi.fn(),
    removeCredential: vi.fn(),
    writeSettings: vi.fn(),
  }
}

/** The editor over one draft, with the probe answering as scripted. */
function renderEditor(
  models: readonly Record<string, unknown>[],
  probe: ModelsOperations['probeReasoningEfforts'],
  onChange: (models: Record<string, unknown>[]) => void,
  probeTarget: ProbeTarget = {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
    baseURL: 'https://acme.test/v1',
    api: 'openai-completions',
  },
): void {
  render(
    <ModelListEditor
      models={models}
      onChange={onChange}
      probe={probeTarget}
      disabled={false}
      t={key => en[key]}
      onBusyChange={() => {}}
      operations={operations(probe)}
    />,
  )
}

it('asks the endpoint about the probed model and shows every level verdict', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({ kind: 'probed', result: probed() })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  expect(probe).toHaveBeenCalledWith('llm-pi-ai', {
    provider: 'acme',
    baseURL: 'https://acme.test/v1',
    api: 'openai-completions',
    model: 'acme-think',
  })
  expect(screen.getByText('low')).toBeTruthy()
  expect(screen.getAllByText(en.effortProbeAccepted).length).toBeGreaterThan(0)
  expect(screen.getAllByText(en.effortProbeRefused)).toHaveLength(1)
  expect(onChange).not.toHaveBeenCalled()
})

it('writes the probed declaration into the probed model only', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({ kind: 'probed', result: probed() })
  const onChange = vi.fn()
  renderEditor(
    [{ id: 'acme-think' }, { id: 'acme-chat', reasoningEfforts: { off: null, low: 'low' } }],
    probe,
    onChange,
  )
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  fireEvent.click(screen.getByRole('button', { name: en.effortProbeWrite }))
  // The other model under the same provider keeps the levels it was given.
  expect(onChange).toHaveBeenCalledWith([
    { id: 'acme-think', reasoningEfforts: { off: null, low: 'low', high: 'high' } },
    { id: 'acme-chat', reasoningEfforts: { off: null, low: 'low' } },
  ])
  expect(await screen.findByText(en.effortProbeWritten)).toBeTruthy()
})

it('shows the refusal of a probe the Host declined', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({ kind: 'refused', message: 'no reasoning-effort probe is registered' })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('no reasoning-effort probe is registered')
  expect(screen.queryByRole('button', { name: en.effortProbeWrite })).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})

it('shows a probe the page could not run at all as a refusal', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockRejectedValueOnce(new Error('the probe seam is not mounted'))
    .mockRejectedValueOnce('the probe seam is not mounted')
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('the probe seam is not mounted')
  // A value that is not an error is read the same way.
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await waitFor(() => { expect(probe).toHaveBeenCalledTimes(2) })
  expect(screen.getAllByText('the probe seam is not mounted')).toHaveLength(1)
  expect(onChange).not.toHaveBeenCalled()
})

it('refuses a declaration that does not map off to no wire value', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({
      kind: 'probed',
      result: probed({ declaration: { off: 'off', low: 'low' } }),
    })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  fireEvent.click(screen.getByRole('button', { name: en.effortProbeWrite }))
  expect(await screen.findByText(en.effortProbeInvalidOff)).toBeTruthy()
  expect(onChange).not.toHaveBeenCalled()
})

it('refuses a declaration that spells a level with an empty wire value', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({
      kind: 'probed',
      result: probed({ declaration: { off: null, low: '' } }),
    })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  fireEvent.click(screen.getByRole('button', { name: en.effortProbeWrite }))
  expect(await screen.findByText(en.effortProbeInvalidLevel)).toBeTruthy()
  expect(onChange).not.toHaveBeenCalled()
})

it('shows a level the endpoint listed itself next to the ones it was probed with', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({
      kind: 'probed',
      result: probed({
        accepted: ['off', 'low', 'high', 'max'],
        declared: ['low', 'high', 'max'],
        outcomes: [
          { level: 'low', accepted: true },
          { level: 'high', accepted: false },
        ],
        refused: [{ level: 'high', detail: '400 unsupported value' }],
      }),
    })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  // The refused level takes the reason the refusal list carries.
  expect(screen.getByText('max')).toBeTruthy()
  expect(screen.getByText(`${en.effortProbeDeclared} low, high, max`)).toBeTruthy()
})

it('keeps the probe unavailable while the row has no model id or no endpoint', () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
  const onChange = vi.fn()
  renderEditor([{ id: '' }], probe, onChange, { settingsNs: 'llm-pi-ai' })
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  const button = screen.getByRole<HTMLButtonElement>('button', { name: en.effortProbe })
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('title')).toBe(en.effortProbeNeedsModel)
  expect(probe).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})

it('explains a draft with neither a route nor an endpoint through the probe title', () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange, { settingsNs: 'llm-pi-ai' })
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  const button = screen.getByRole<HTMLButtonElement>('button', { name: en.effortProbe })
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('title')).toBe(en.effortProbeNeedsBaseUrl)
})

it('asks a draft that names only an endpoint, without a route, a protocol, or a key', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({ kind: 'probed', result: probed() })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange, {
    settingsNs: 'llm-pi-ai',
    baseURL: 'https://acme.test/v1',
  })
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  expect(probe).toHaveBeenCalledWith('llm-pi-ai', {
    baseURL: 'https://acme.test/v1',
    model: 'acme-think',
  })
})

it('asks a named route that has no endpoint of its own', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({ kind: 'probed', result: probed() })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange, {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
  })
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  expect(probe).toHaveBeenCalledWith('llm-pi-ai', {
    provider: 'acme',
    model: 'acme-think',
  })
})

it('carries the key typed into the form into the probe', async () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
    .mockResolvedValue({ kind: 'probed', result: probed() })
  const onChange = vi.fn()
  renderEditor([{ id: 'acme-think' }], probe, onChange, {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
    baseURL: 'https://acme.test/v1',
    api: 'openai-completions',
    apiKey: 'sk-typed',
  })
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await screen.findByText('400 unsupported value')
  expect(probe).toHaveBeenCalledWith('llm-pi-ai', {
    provider: 'acme',
    baseURL: 'https://acme.test/v1',
    api: 'openai-completions',
    model: 'acme-think',
    apiKey: 'sk-typed',
  })
})

it('explains a blocked endpoint through the probe action title', () => {
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>()
  const onChange = vi.fn()
  render(
    <ModelListEditor
      models={[{ id: 'acme-think' }]}
      onChange={onChange}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'acme', baseURL: 'https://acme.test/v1' }}
      probeBlocked="keyBlank"
      disabled={false}
      t={key => en[key]}
      onBusyChange={() => {}}
      operations={operations(probe)}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  const button = screen.getByRole<HTMLButtonElement>('button', { name: en.effortProbe })
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('title')).toBe(en.keyBlank)
})

it('binds the effort probe to the llm namespace and reports a refusal', async () => {
  const remoteProbe = vi.fn(() => Promise.resolve({ ok: true, value: probed() }))
  const ctx = {
    remote: {
      llm: {
        probeReasoningEfforts: remoteProbe,
      },
    },
  } as never
  const bound = createModelsOperations(ctx)
  const answer = await bound.probeReasoningEfforts('llm-pi-ai', { model: 'acme-think' })
  expect(answer).toEqual({ kind: 'probed', result: probed() })
  expect(remoteProbe).toHaveBeenCalledWith('llm-pi-ai', { model: 'acme-think' })
})

it('turns a refused probe into the refusal branch', async () => {
  const remoteProbe = vi.fn(() => Promise.resolve({
    ok: false,
    error: { code: 'llm/reasoning-effort-probe-rejected', message: 'the probe refused' },
  }))
  const ctx = { remote: { llm: { probeReasoningEfforts: remoteProbe } } } as never
  const bound = createModelsOperations(ctx)
  const answer = await bound.probeReasoningEfforts('llm-pi-ai', { model: 'acme-think' })
  expect(answer).toEqual({ kind: 'refused', message: 'the probe refused' })
})

it('holds the surface still while a probe is in flight', async () => {
  const pending = Promise.withResolvers<{ kind: 'probed'; result: LlmReasoningEffortProbeResult }>()
  const probe = vi.fn<ModelsOperations['probeReasoningEfforts']>(() => pending.promise)
  const onChange = vi.fn()
  const onBusyChange = vi.fn()
  render(
    <ModelListEditor
      models={[{ id: 'acme-think' }]}
      onChange={onChange}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'acme', baseURL: 'https://acme.test/v1' }}
      disabled={false}
      t={key => en[key]}
      onBusyChange={onBusyChange}
      operations={operations(probe)}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
  fireEvent.click(screen.getByRole('button', { name: en.effortProbe }))
  await waitFor(() => { expect(onBusyChange).toHaveBeenCalledWith(true) })
  expect(screen.getByRole('button', { name: en.effortProbing })).toBeTruthy()
  pending.resolve({ kind: 'probed', result: probed() })
  await waitFor(() => { expect(onBusyChange).toHaveBeenCalledWith(false) })
})
