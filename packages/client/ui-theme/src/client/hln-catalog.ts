/**
 * HLN UI System v3.5 selection catalogs and the local selection record the
 * settings row persists. Catalog ids mirror the official v3.5 dist
 * (@projecthln/ui-system-v3.5: the themes.css selectors, the font/CJK-mode
 * matrix, and the background-preset list). v3.5 ships native light themes
 * (alabaster-studio, bauhaus-compiler), so light is a theme card like any
 * other. Applying a selection is the shell's job through `window.HLN` — this
 * module only validates and migrates ids and stores the last choice for
 * boot-time restore.
 */

/** One selectable HLN theme with its official dist picker colors. */
export interface HlnThemeInfo {
  /** Theme id (`:root[data-hln-theme]` value). */
  id: HlnThemeId
  /** Official accent color, for the picker swatch. */
  accent: string
  /** Official swatch plane behind the accent (the theme's own bg tone). */
  swatch: string
  /** Which base scheme the theme ships. */
  colorScheme: 'dark' | 'light'
}

/** Official v3.5 theme ids (dist order). */
export type HlnThemeId =
  | 'singularity-cyan' | 'tensor-amber' | 'veridian-stream'
  | 'synapse-violet' | 'cobalt-manifold' | 'titanium-oxide'
  | 'alabaster-studio' | 'bauhaus-compiler'

/** Official v3.5 theme registry (HLN_V35_THEME_REGISTRY picker data). */
export const HLN_THEMES: readonly HlnThemeInfo[] = Object.freeze([
  { id: 'singularity-cyan', accent: '#00f0ff', swatch: '#0f1622', colorScheme: 'dark' },
  { id: 'tensor-amber', accent: '#ffb800', swatch: '#141922', colorScheme: 'dark' },
  { id: 'veridian-stream', accent: '#00e699', swatch: '#0d1d1a', colorScheme: 'dark' },
  { id: 'synapse-violet', accent: '#b366ff', swatch: '#131024', colorScheme: 'dark' },
  { id: 'cobalt-manifold', accent: '#38bdf8', swatch: '#0d1b2e', colorScheme: 'dark' },
  { id: 'titanium-oxide', accent: '#f8fafc', swatch: '#161920', colorScheme: 'dark' },
  { id: 'alabaster-studio', accent: '#2563eb', swatch: '#ffffff', colorScheme: 'light' },
  { id: 'bauhaus-compiler', accent: '#dc2626', swatch: '#fcfaf5', colorScheme: 'light' },
])

/** Official v3.5 font-mode ids. */
export type HlnFontId =
  | 'geometric' | 'display' | 'technical' | 'grotesque'
  | 'cyber' | 'berlin' | 'editorial' | 'label'

/** Official v3.5 font ids (dist order). */
export const HLN_FONTS: readonly HlnFontId[] = Object.freeze([
  'geometric', 'display', 'technical', 'grotesque', 'cyber', 'berlin', 'editorial', 'label',
])

/** Font id → CSS custom property carrying that family's stack. */
export const HLN_FONT_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  geometric: '--hln-ui-font-geometric',
  display: '--hln-ui-font-display',
  technical: '--hln-ui-font-technical',
  grotesque: '--hln-ui-font-neo-grotesque',
  cyber: '--hln-ui-font-cyber-mono',
  berlin: '--hln-ui-font-berlin',
  editorial: '--hln-ui-font-editorial',
  label: '--hln-ui-font-label',
})

/** Official v3.5 CJK font-mode ids. */
export type HlnCjkFontId = 'auto' | 'hei' | 'display' | 'song' | 'kai' | 'mono' | 'fangsong'

/** Official v3.5 CJK font ids (dist order). */
export const HLN_CJK_FONTS: readonly HlnCjkFontId[] = Object.freeze([
  'auto', 'hei', 'display', 'song', 'kai', 'mono', 'fangsong',
])

/** Official v3.5 background-preset ids. */
export type HlnBgMotionId =
  | 'tensor-stream' | 'neural-dag' | 'fourier-harmonics' | 'procedural-matrix'
  | 'simplex-contour' | 'clock-bus' | 'swiss-vector' | 'quiet'

/** Official v3.5 background-preset ids (dist order). */
export const HLN_BG_MOTIONS: readonly HlnBgMotionId[] = Object.freeze([
  'tensor-stream', 'neural-dag', 'fourier-harmonics', 'procedural-matrix',
  'simplex-contour', 'clock-bus', 'swiss-vector', 'quiet',
])

/** One full HLN selection: theme, fonts, and background preset. */
export interface HlnSelection {
  /** `:root[data-hln-theme]` id. */
  theme: string
  /** `[data-hln-font]` id. */
  font: string
  /** CJK font mode (`data-hln-cjk-font` id). */
  cjk: string
  /** `#root[data-hln-bg-motion]` preset id. */
  bgMotion: string
}

/** Selection applied before the user picks anything (the index.html defaults). */
export const HLN_DEFAULT_SELECTION: HlnSelection = Object.freeze({
  theme: 'singularity-cyan', font: 'display', cjk: 'auto', bgMotion: 'tensor-stream',
})

/** localStorage key holding the persisted selection. */
export const HLN_SELECTION_KEY = 'cetusprism.hln.ui.v1'

/** Legacy theme ids (v2.3 and the v3.2 linear planes) that map onto a v3.5 successor. */
const THEME_MIGRATIONS: Readonly<Record<string, HlnThemeId>> = Object.freeze({
  'cetus-light': 'alabaster-studio',
  'linear-obsidian': 'singularity-cyan',
  'linear-platinum': 'alabaster-studio',
  'linear-amber': 'tensor-amber',
  'linear-paper': 'alabaster-studio',
  'linear-emerald': 'veridian-stream',
  'linear-mono': 'titanium-oxide',
})

/** Legacy font ids that map onto a v3.5 successor instead of the default. */
const FONT_MIGRATIONS: Readonly<Record<string, HlnFontId>> = Object.freeze({
  condensed: 'grotesque',
})

/** Legacy v3.2 background-preset ids that map onto a v3.5 successor. */
const BG_MOTION_MIGRATIONS: Readonly<Record<string, HlnBgMotionId>> = Object.freeze({
  'horizon-rule': 'swiss-vector',
  'axial-cross': 'swiss-vector',
  'parallel-lines': 'procedural-matrix',
  'fine-grain-line': 'procedural-matrix',
})

/**
 * Validate one stored selection against the official catalogs. Unknown fields
 * migrate their documented successor or fall back per field, so a partially
 * corrupted record degrades field-by-field instead of resetting the whole
 * selection.
 * @param value - parsed JSON of unknown shape.
 * @returns a complete, valid selection.
 */
export function validateSelection(value: unknown): HlnSelection {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const themeIds = HLN_THEMES.map(theme => theme.id)
  const field = (raw: unknown, catalog: readonly string[], fallback: string): string =>
    typeof raw === 'string' && catalog.includes(raw) ? raw : fallback
  const migrated = (raw: unknown, catalog: readonly string[], migrations: Readonly<Record<string, string>>, fallback: string): string =>
    field(raw, catalog, typeof raw === 'string' ? migrations[raw] ?? fallback : fallback)
  return {
    theme: migrated(record.theme, themeIds, THEME_MIGRATIONS, HLN_DEFAULT_SELECTION.theme),
    font: migrated(record.font, HLN_FONTS, FONT_MIGRATIONS, HLN_DEFAULT_SELECTION.font),
    cjk: field(record.cjk, HLN_CJK_FONTS, HLN_DEFAULT_SELECTION.cjk),
    bgMotion: migrated(record.bgMotion, HLN_BG_MOTIONS, BG_MOTION_MIGRATIONS, HLN_DEFAULT_SELECTION.bgMotion),
  }
}

/**
 * Read the persisted selection.
 * @param storage - localStorage-shaped store; `undefined` (non-browser or
 * refused storage) yields the defaults.
 * @returns the stored selection, or the defaults when absent or unreadable.
 */
export function readHlnSelection(storage: Pick<Storage, 'getItem'> | undefined): HlnSelection {
  if (storage === undefined) return { ...HLN_DEFAULT_SELECTION }
  let raw: string | null
  try {
    raw = storage.getItem(HLN_SELECTION_KEY)
  } catch {
    // Storage can refuse reads (privacy mode); the default selection stands.
    return { ...HLN_DEFAULT_SELECTION }
  }
  if (raw === null) return { ...HLN_DEFAULT_SELECTION }
  try {
    return validateSelection(JSON.parse(raw))
  } catch {
    // Unparseable record: treat as absent rather than surfacing an error.
    return { ...HLN_DEFAULT_SELECTION }
  }
}

/**
 * Persist one selection. Storage failures are swallowed — the applied DOM
 * state stays correct for the session; only the boot-time restore is lost.
 * @param storage - localStorage-shaped store; `undefined` is a no-op.
 * @param selection - the full selection to store.
 */
export function writeHlnSelection(storage: Pick<Storage, 'setItem'> | undefined, selection: HlnSelection): void {
  if (storage === undefined) return
  try {
    storage.setItem(HLN_SELECTION_KEY, JSON.stringify(selection))
  } catch {
    // Quota or privacy-mode failures keep the live selection; nothing else can reach it.
  }
}
