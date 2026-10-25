/**
 * The Models page merges a burst of Host invalidations into one read.
 *
 * The Host announces provider-topology, settings and credential changes as
 * payload-free events, and one change can produce several of them. Each read
 * of the page costs a provider directory read, a settings describe and a
 * credential describe, so the burst is merged instead of being replayed.
 */
import { describe, expect, it, vi } from 'vitest'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { settingsSchema } from './settings-schema.client.ts'
import { MODELS_SETTINGS_COALESCE_MS, ModelsSettingsStore } from '../src/client/store.ts'

const NAMESPACES = [
  {
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: { csu: { apiKeyEnv: 'CSU_API_KEY' } } },
    user: { providers: { csu: { apiKeyEnv: 'CSU_API_KEY' } } },
    autoGenerate: true, applies: 'live' as const,
    secrets: [],
    revision: 0,
  },
]

interface Fixture {
  readonly ctx: never
  readonly mirror: SettingsDescribeMirror
  readonly listProviders: ReturnType<typeof vi.fn>
}

function build(): Fixture {
  const listProviders = vi.fn(async () => ({
    ok: true as const,
    value: [{ id: 'csu', name: 'csu' }],
  }))
  const ctx = {
    remote: {
      session: { modelCatalog: async () => ({ ok: true as const, value: { groups: [] } }) },
      llm: {
        listProviders,
        listConfigurableProviders: async () => ({
          ok: true as const,
          value: [{
            provider: 'csu', displayName: 'csu', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'csu'],
          }],
        }),
      },
      credentials: { describe: async () => ({ ok: true as const, value: {} }) },
      settings: {
        describe: async () => ({
          ok: true as const,
          value: { writable: true, hasDocument: false, namespaces: NAMESPACES },
        }),
      },
    },
  } as never
  return { ctx, mirror: new SettingsDescribeMirror(ctx), listProviders }
}

describe('ModelsSettingsStore refresh', () => {
  it('merges a burst of invalidations into one read', async () => {
    const f = build()
    const store = new ModelsSettingsStore(f.ctx, settingsSchema, f.mirror)
    await store.load()
    expect(f.listProviders).toHaveBeenCalledTimes(1)

    store.refresh()
    store.refresh()
    store.refresh()
    store.refresh()

    await vi.waitFor(() => { expect(f.listProviders).toHaveBeenCalledTimes(2) })
    // The merged window closed with one read; the burst added no more.
    await new Promise(resolve => { setTimeout(resolve, MODELS_SETTINGS_COALESCE_MS * 3) })
    expect(f.listProviders).toHaveBeenCalledTimes(2)
  })

  it('does not read a page that was never opened', async () => {
    const f = build()
    const store = new ModelsSettingsStore(f.ctx, settingsSchema, f.mirror)

    store.refresh()
    await new Promise(resolve => { setTimeout(resolve, MODELS_SETTINGS_COALESCE_MS * 3) })

    expect(f.listProviders).not.toHaveBeenCalled()
  })
})
