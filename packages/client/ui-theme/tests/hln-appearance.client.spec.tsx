// @vitest-environment jsdom
/** HLN selection row: catalog validation/migration + persistence, and the
 * row's render/click behavior against the store mirror. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { HlnAppearanceRow } from '../src/client/HlnAppearanceRow.tsx'
import type { HlnRowComponentProps } from '../src/client/HlnAppearanceRow.tsx'
import { createHlnRowStore } from '../src/client/hln-store.ts'
import { hlnEn } from '../src/client/hln-locales.ts'
import {
  HLN_BG_MOTIONS, HLN_CJK_FONTS, HLN_DEFAULT_SELECTION, HLN_FONTS, HLN_SELECTION_KEY, HLN_THEMES,
  readHlnSelection, validateSelection, writeHlnSelection,
} from '../src/client/hln-catalog.ts'

afterEach(cleanup)

/** The row's copy resolves through the English dictionary in tests. */
const COPY = hlnEn as Record<string, string>
const themeLabel = (id: string): string => COPY[`theme.${id}`] ?? id
const cjkLabel = (id: string): string => COPY[`cjk.${id}`] ?? id
const motionLabel = (id: string): string => COPY[`motion.${id}`] ?? id

/** In-memory localStorage stand-in. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getLength: () => 0,
    key: () => null,
    clear: () => {},
    removeItem: (key: string) => { map.delete(key) },
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
  } as unknown as Storage
}

describe('hln catalog', () => {
  it('validateSelection accepts official ids and degrades unknown fields per field', () => {
    expect(validateSelection({ theme: 'tensor-amber', font: 'editorial', cjk: 'song', bgMotion: 'neural-dag' }))
      .toEqual({ theme: 'tensor-amber', font: 'editorial', cjk: 'song', bgMotion: 'neural-dag' })
    expect(validateSelection({ theme: 'nope', extra: true })).toEqual(HLN_DEFAULT_SELECTION)
    expect(validateSelection('garbage')).toEqual(HLN_DEFAULT_SELECTION)
  })

  it('migrates legacy v2.3/v3.2 ids onto their v3.5 successors; unknown ids take the defaults', () => {
    expect(validateSelection({ theme: 'cetus-light' })).toMatchObject({ theme: 'alabaster-studio' })
    expect(validateSelection({ theme: 'linear-obsidian' })).toMatchObject({ theme: 'singularity-cyan' })
    expect(validateSelection({ theme: 'linear-platinum' })).toMatchObject({ theme: 'alabaster-studio' })
    expect(validateSelection({ font: 'cyber' })).toMatchObject({ font: 'cyber' })
    expect(validateSelection({ font: 'berlin' })).toMatchObject({ font: 'berlin' })
    expect(validateSelection({ font: 'condensed' })).toMatchObject({ font: 'grotesque' })
    expect(validateSelection({ bgMotion: 'horizon-rule' })).toMatchObject({ bgMotion: 'swiss-vector' })
    expect(validateSelection({ bgMotion: 'parallel-lines' })).toMatchObject({ bgMotion: 'procedural-matrix' })
    // Every retired id without a successor resets field-by-field.
    expect(validateSelection({ theme: 'arknights', font: 'display', bgMotion: 'tactical-grid' }))
      .toEqual({ ...HLN_DEFAULT_SELECTION, font: 'display' })
  })

  it('read/write round-trip; unparseable records read as the defaults', () => {
    const storage = memoryStorage()
    expect(readHlnSelection(storage)).toEqual(HLN_DEFAULT_SELECTION)
    const selection = { theme: 'veridian-stream', font: 'cyber', cjk: 'kai', bgMotion: 'clock-bus' }
    writeHlnSelection(storage, selection)
    expect(readHlnSelection(storage)).toEqual(selection)
    storage.setItem(HLN_SELECTION_KEY, '{not json')
    expect(readHlnSelection(storage)).toEqual(HLN_DEFAULT_SELECTION)
  })

  it('refused reads fall back to defaults and failing writes are swallowed', () => {
    const refusing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
    }
    expect(readHlnSelection(refusing)).toEqual(HLN_DEFAULT_SELECTION)
    expect(() => { writeHlnSelection(refusing, { ...HLN_DEFAULT_SELECTION, bgMotion: 'quiet' }) }).not.toThrow()
    expect(readHlnSelection(undefined)).toEqual(HLN_DEFAULT_SELECTION)
  })
})

/** Mount the row on a real store instance with recording setters. */
function mount(selection = { ...HLN_DEFAULT_SELECTION }) {
  const store = createHlnRowStore().create()
  store.actions.set(selection)
  const setters = {
    setHlnTheme: vi.fn(),
    setHlnFont: vi.fn(),
    setHlnCjk: vi.fn(),
    setHlnBgMotion: vi.fn(),
  }
  const props = {
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    ...setters,
  } as unknown as HlnRowComponentProps
  render(<HlnAppearanceRow {...props} />)
  return { store, setters }
}

describe('HlnAppearanceRow', () => {
  it('renders every theme, font, CJK font, and background-preset card', () => {
    mount()
    expect(screen.getByText('HLN Interface Style')).toBeDefined()
    // Card labels can collide across groups, so each labeled grid scopes its
    // own queries.
    const themes = within(screen.getByRole('group', { name: 'Theme' }))
    for (const theme of HLN_THEMES) {
      expect(themes.getByRole('button', { name: themeLabel(theme.id) })).toBeDefined()
    }
    for (const font of HLN_FONTS) {
      // Font chips append the glyph sample to their accessible name.
      expect(screen.getByRole('button', { name: new RegExp(`^${font}`) })).toBeDefined()
    }
    const cjkFonts = within(screen.getByRole('group', { name: 'Chinese font' }))
    for (const cjk of HLN_CJK_FONTS) {
      expect(cjkFonts.getByRole('button', { name: cjkLabel(cjk) })).toBeDefined()
    }
    const motions = within(screen.getByRole('group', { name: 'Background effects' }))
    for (const motion of HLN_BG_MOTIONS) {
      expect(motions.getByRole('button', { name: motionLabel(motion) })).toBeDefined()
    }
  })

  it('clicks drive the injected setters; selection follows the store mirror', () => {
    const mounted = mount()
    const themes = within(screen.getByRole('group', { name: 'Theme' }))
    const cjkFonts = within(screen.getByRole('group', { name: 'Chinese font' }))
    const motions = within(screen.getByRole('group', { name: 'Background effects' }))
    fireEvent.click(themes.getByRole('button', { name: themeLabel('tensor-amber') }))
    expect(mounted.setters.setHlnTheme).toHaveBeenCalledWith('tensor-amber')
    fireEvent.click(motions.getByRole('button', { name: motionLabel('quiet') }))
    expect(mounted.setters.setHlnBgMotion).toHaveBeenCalledWith('quiet')
    fireEvent.click(screen.getByRole('button', { name: /^grotesque/ }))
    expect(mounted.setters.setHlnFont).toHaveBeenCalledWith('grotesque')
    fireEvent.click(cjkFonts.getByRole('button', { name: cjkLabel('song') }))
    expect(mounted.setters.setHlnCjk).toHaveBeenCalledWith('song')
    act(() => { mounted.store.actions.set({ theme: 'tensor-amber', font: 'grotesque', cjk: 'song', bgMotion: 'quiet' }) })
    expect(themes.getByRole('button', { name: themeLabel('tensor-amber') }).getAttribute('aria-pressed')).toBe('true')
    expect(motions.getByRole('button', { name: motionLabel('quiet') }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^grotesque/ }).getAttribute('aria-pressed')).toBe('true')
    expect(cjkFonts.getByRole('button', { name: cjkLabel('song') }).getAttribute('aria-pressed')).toBe('true')
  })
})
