/**
 * HLN UI System v4 selection catalogs and the local selection record the
 * settings row persists. Catalog ids mirror the official v4 dist
 * (@projecthln/ui-system-v4: the themes.css selectors, the font/CJK-mode
 * matrix, and the background-preset list), alongside supported legacy themes.
 * Each theme defines a complete, unified design system pairing primary/secondary
 * pigments with harmonious default typography and ambient background presets.
 */

/** One selectable HLN theme with its official dist picker colors and unified defaults. */
export interface HlnThemeInfo {
  /** Theme id (`:root[data-hln-theme]` value). */
  id: HlnThemeId
  /** Official accent color (primary pigment), for the picker swatch. */
  accent: string
  /** Official secondary accent (cool pigment), for dual-pigment contrast. */
  accentCool: string
  /** Official swatch plane behind the accent (the theme's own bg tone). */
  swatch: string
  /** Which base scheme the theme ships. */
  colorScheme: 'dark' | 'light'
  /** Paired default Latin font profile for this theme. */
  defaultFont: HlnFontId
  /** Paired default CJK font profile for this theme. */
  defaultCjk: HlnCjkFontId
  /** Paired default background preset for this theme. */
  defaultBgMotion: HlnBgMotionId
}

/** Official v4 and supported legacy theme ids. */
export type HlnThemeId =
  | 'folio-graphite' | 'folio-porcelain' | 'folio-pine' | 'folio-slate'
  | 'folio-apricot' | 'folio-plum' | 'folio-sage' | 'folio-lilac'
  | 'singularity-cyan' | 'tensor-amber' | 'veridian-stream'
  | 'synapse-violet' | 'cobalt-manifold' | 'titanium-oxide'
  | 'alabaster-studio' | 'bauhaus-compiler'

/** Official theme registry with dual-pigment palettes and unified typography pairs. */
export const HLN_THEMES: readonly HlnThemeInfo[] = Object.freeze([
  // KalciriteUI v4 Folio Curated Themes (Unified Palette & Typography)
  {
    id: 'folio-graphite',
    accent: '#d9a441',
    accentCool: '#6f9dd1',
    swatch: '#1c1f23',
    colorScheme: 'dark',
    defaultFont: 'grotesque',
    defaultCjk: 'hei',
    defaultBgMotion: 'tensor-stream',
  },
  {
    id: 'folio-porcelain',
    accent: '#2f4b7c',
    accentCool: '#3f7d6e',
    swatch: '#fdfcfa',
    colorScheme: 'light',
    defaultFont: 'editorial',
    defaultCjk: 'display',
    defaultBgMotion: 'tint-wash',
  },
  {
    id: 'folio-pine',
    accent: '#cbb27a',
    accentCool: '#4f9e83',
    swatch: '#161e1a',
    colorScheme: 'dark',
    defaultFont: 'grotesque',
    defaultCjk: 'hei',
    defaultBgMotion: 'ruled-lines',
  },
  {
    id: 'folio-slate',
    accent: '#7f9be0',
    accentCool: '#4f9e94',
    swatch: '#171b21',
    colorScheme: 'dark',
    defaultFont: 'display',
    defaultCjk: 'hei',
    defaultBgMotion: 'folio-grid',
  },
  {
    id: 'folio-apricot',
    accent: '#974725',
    accentCool: '#35707a',
    swatch: '#fffaf5',
    colorScheme: 'light',
    defaultFont: 'editorial',
    defaultCjk: 'display',
    defaultBgMotion: 'tint-wash',
  },
  {
    id: 'folio-plum',
    accent: '#cf8a5a',
    accentCool: '#a87bc4',
    swatch: '#1d1822',
    colorScheme: 'dark',
    defaultFont: 'editorial',
    defaultCjk: 'kai',
    defaultBgMotion: 'vellum-fiber',
  },
  {
    id: 'folio-sage',
    accent: '#2d664b',
    accentCool: '#a8593f',
    swatch: '#f7f9f5',
    colorScheme: 'light',
    defaultFont: 'grotesque',
    defaultCjk: 'hei',
    defaultBgMotion: 'paper-grain',
  },
  {
    id: 'folio-lilac',
    accent: '#5b4b9e',
    accentCool: '#a85571',
    swatch: '#faf9fd',
    colorScheme: 'light',
    defaultFont: 'editorial',
    defaultCjk: 'kai',
    defaultBgMotion: 'margin-rule',
  },
  // Supported Classic Themes
  {
    id: 'singularity-cyan',
    accent: '#00f0ff',
    accentCool: '#38bdf8',
    swatch: '#0f1622',
    colorScheme: 'dark',
    defaultFont: 'technical',
    defaultCjk: 'auto',
    defaultBgMotion: 'tensor-stream',
  },
  {
    id: 'tensor-amber',
    accent: '#ffb800',
    accentCool: '#00f0ff',
    swatch: '#141922',
    colorScheme: 'dark',
    defaultFont: 'display',
    defaultCjk: 'auto',
    defaultBgMotion: 'tensor-stream',
  },
  {
    id: 'veridian-stream',
    accent: '#00e699',
    accentCool: '#38bdf8',
    swatch: '#0d1d1a',
    colorScheme: 'dark',
    defaultFont: 'grotesque',
    defaultCjk: 'auto',
    defaultBgMotion: 'neural-dag',
  },
  {
    id: 'synapse-violet',
    accent: '#b366ff',
    accentCool: '#ff66b3',
    swatch: '#131024',
    colorScheme: 'dark',
    defaultFont: 'editorial',
    defaultCjk: 'auto',
    defaultBgMotion: 'fourier-harmonics',
  },
  {
    id: 'cobalt-manifold',
    accent: '#38bdf8',
    accentCool: '#00e699',
    swatch: '#0d1b2e',
    colorScheme: 'dark',
    defaultFont: 'technical',
    defaultCjk: 'auto',
    defaultBgMotion: 'procedural-matrix',
  },
  {
    id: 'titanium-oxide',
    accent: '#f8fafc',
    accentCool: '#94a3b8',
    swatch: '#161920',
    colorScheme: 'dark',
    defaultFont: 'grotesque',
    defaultCjk: 'auto',
    defaultBgMotion: 'swiss-vector',
  },
  {
    id: 'alabaster-studio',
    accent: '#2563eb',
    accentCool: '#38bdf8',
    swatch: '#ffffff',
    colorScheme: 'light',
    defaultFont: 'editorial',
    defaultCjk: 'auto',
    defaultBgMotion: 'quiet',
  },
  {
    id: 'bauhaus-compiler',
    accent: '#dc2626',
    accentCool: '#2563eb',
    swatch: '#fcfaf5',
    colorScheme: 'light',
    defaultFont: 'display',
    defaultCjk: 'auto',
    defaultBgMotion: 'quiet',
  },
])

/** Selectable font-mode ids. */
export type HlnFontId =
  | 'geometric' | 'display' | 'technical' | 'grotesque'
  | 'cyber' | 'berlin' | 'editorial' | 'label' | 'fangsong'

/** Font ids list. */
export const HLN_FONTS: readonly HlnFontId[] = Object.freeze([
  'grotesque', 'display', 'editorial', 'technical', 'geometric', 'cyber', 'berlin', 'label', 'fangsong',
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
  fangsong: '--hln-ui-font-fangsong',
})

/** Selectable CJK font-mode ids. */
export type HlnCjkFontId = 'auto' | 'hei' | 'display' | 'song' | 'kai' | 'mono' | 'fangsong'

/** CJK font ids list. */
export const HLN_CJK_FONTS: readonly HlnCjkFontId[] = Object.freeze([
  'auto', 'hei', 'display', 'song', 'kai', 'mono', 'fangsong',
])

/** Selectable background-preset ids (algorithmic motion + v4 static ambient). */
export type HlnBgMotionId =
  | 'tensor-stream' | 'neural-dag' | 'fourier-harmonics' | 'procedural-matrix'
  | 'simplex-contour' | 'clock-bus' | 'swiss-vector'
  | 'paper-grain' | 'margin-rule' | 'tint-wash' | 'ruled-lines' | 'folio-grid' | 'vellum-fiber'
  | 'quiet'

/** Background-preset ids list. */
export const HLN_BG_MOTIONS: readonly HlnBgMotionId[] = Object.freeze([
  'tensor-stream', 'neural-dag', 'fourier-harmonics', 'procedural-matrix',
  'simplex-contour', 'clock-bus', 'swiss-vector',
  'paper-grain', 'margin-rule', 'tint-wash', 'ruled-lines', 'folio-grid', 'vellum-fiber',
  'quiet',
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

/** Legacy theme ids that map onto a supported successor. */
const THEME_MIGRATIONS: Readonly<Record<string, HlnThemeId>> = Object.freeze({
  'cetus-light': 'alabaster-studio',
  'linear-obsidian': 'singularity-cyan',
  'linear-platinum': 'alabaster-studio',
  'linear-amber': 'tensor-amber',
  'linear-paper': 'alabaster-studio',
  'linear-emerald': 'veridian-stream',
  'linear-mono': 'titanium-oxide',
})

/** Legacy font ids that map onto a successor. */
const FONT_MIGRATIONS: Readonly<Record<string, HlnFontId>> = Object.freeze({
  condensed: 'grotesque',
})

/** Legacy background-preset ids that map onto a successor. */
const BG_MOTION_MIGRATIONS: Readonly<Record<string, HlnBgMotionId>> = Object.freeze({
  'horizon-rule': 'swiss-vector',
  'axial-cross': 'swiss-vector',
  'parallel-lines': 'procedural-matrix',
  'fine-grain-line': 'procedural-matrix',
})

/**
 * Validate one stored selection against the official catalogs.
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
 * @param storage - localStorage-shaped store; `undefined` yields the defaults.
 * @returns the stored selection, or the defaults when absent or unreadable.
 */
export function readHlnSelection(storage: Pick<Storage, 'getItem'> | undefined): HlnSelection {
  if (storage === undefined) return { ...HLN_DEFAULT_SELECTION }
  let raw: string | null
  try {
    raw = storage.getItem(HLN_SELECTION_KEY)
  } catch {
    return { ...HLN_DEFAULT_SELECTION }
  }
  if (raw === null) return { ...HLN_DEFAULT_SELECTION }
  try {
    return validateSelection(JSON.parse(raw))
  } catch {
    return { ...HLN_DEFAULT_SELECTION }
  }
}

/**
 * Persist one selection.
 * @param storage - localStorage-shaped store; `undefined` is a no-op.
 * @param selection - the full selection to store.
 */
export function writeHlnSelection(storage: Pick<Storage, 'setItem'> | undefined, selection: HlnSelection): void {
  if (storage === undefined) return
  try {
    storage.setItem(HLN_SELECTION_KEY, JSON.stringify(selection))
  } catch {
    // Quota or privacy-mode failures keep the live selection
  }
}
