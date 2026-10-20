import { describe, expect, it } from 'vitest'
import {
  builtinAgentBackendCatalog,
  BuiltinAgentBackendRegistry,
  BuiltinAgentBackendSelectionError,
  parseBuiltinAgentBackend,
  resolveBuiltinAgentBackend,
} from '../src/backend.ts'

describe('execution backend catalog', () => {
  it('exposes DSH, Pi, and ZCode as separate backends', () => {
    expect(builtinAgentBackendCatalog().map(backend => backend.id)).toEqual(['dsh', 'pi', 'zcode'])
    expect(builtinAgentBackendCatalog()[0]).toMatchObject({ id: 'dsh', availability: 'ready' })
    expect(builtinAgentBackendCatalog()[1]).toMatchObject({ id: 'pi', availability: 'unconfigured' })
    expect(builtinAgentBackendCatalog()[2]).toMatchObject({ id: 'zcode', availability: 'unconfigured' })
  })

  it('only marks an external backend ready after an explicit compatible probe', () => {
    const catalog = builtinAgentBackendCatalog({
      zcode: { version: '3.16.2', source: 'external-runtime', compatible: true },
    })
    expect(resolveBuiltinAgentBackend('zcode', catalog).version).toBe('3.16.2')
    expect(() => resolveBuiltinAgentBackend('pi', catalog)).toThrow(BuiltinAgentBackendSelectionError)
  })

  it('keeps old configuration compatible and rejects unknown ids', () => {
    expect(parseBuiltinAgentBackend(undefined)).toBe('dsh')
    expect(parseBuiltinAgentBackend('pi')).toBe('pi')
    expect(() => parseBuiltinAgentBackend('opencode')).toThrow(BuiltinAgentBackendSelectionError)
  })

  it('reports an incompatible runtime instead of dropping the backend', () => {
    const catalog = builtinAgentBackendCatalog({
      pi: { version: '1.3.0', source: 'external-runtime', compatible: false, reason: 'protocol version 2 is not supported' },
    })
    const pi = catalog.find(backend => backend.id === 'pi')
    expect(pi).toMatchObject({ availability: 'incompatible', reason: 'protocol version 2 is not supported' })
    expect(() => resolveBuiltinAgentBackend('pi', catalog)).toThrow(BuiltinAgentBackendSelectionError)
  })
})

describe('execution backend registry', () => {
  it('keeps an unregistered backend visible and unconfigured', () => {
    const registry = new BuiltinAgentBackendRegistry()
    expect(registry.catalog().map(backend => backend.id)).toEqual(['dsh', 'pi', 'zcode'])
    expect(registry.catalog().find(backend => backend.id === 'zcode')).toMatchObject({ availability: 'unconfigured' })
    expect(() => registry.resolve('zcode')).toThrow(BuiltinAgentBackendSelectionError)
  })

  it('marks a registered runtime ready and removes it again on dispose', () => {
    const registry = new BuiltinAgentBackendRegistry()
    const dispose = registry.register({
      id: 'zcode',
      describe: () => ({ version: '3.16.2', source: 'external-runtime', compatible: true }),
    })
    expect(registry.resolve('zcode')).toMatchObject({ availability: 'ready', version: '3.16.2' })
    expect(registry.wireCatalog().backends).toHaveLength(3)

    dispose()
    expect(registry.catalog().find(backend => backend.id === 'zcode')).toMatchObject({ availability: 'unconfigured' })
    expect(() => registry.resolve('zcode')).toThrow(BuiltinAgentBackendSelectionError)
  })

  it('keeps a later registration when an earlier disposer runs', () => {
    const registry = new BuiltinAgentBackendRegistry()
    const first = registry.register({
      id: 'pi',
      describe: () => ({ version: '1.0.0', source: 'external-runtime', compatible: true }),
    })
    const second = registry.register({
      id: 'pi',
      describe: () => ({ version: '1.3.0', source: 'external-runtime', compatible: true }),
    })
    first()
    expect(registry.resolve('pi')).toMatchObject({ version: '1.3.0' })
    second()
    expect(registry.catalog().find(backend => backend.id === 'pi')).toMatchObject({ availability: 'unconfigured' })
  })

  it('reports a failing probe as an unusable backend rather than hiding it', () => {
    const registry = new BuiltinAgentBackendRegistry()
    registry.register({
      id: 'zcode',
      describe: () => { throw new Error('runtime handshake failed') },
    })
    const zcode = registry.catalog().find(backend => backend.id === 'zcode')
    expect(zcode).toMatchObject({ availability: 'incompatible', reason: 'runtime handshake failed' })
    expect(() => registry.resolve('zcode')).toThrow(BuiltinAgentBackendSelectionError)
  })
})
