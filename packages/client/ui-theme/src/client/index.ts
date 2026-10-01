/**
 * Browser theme registry over the `--dsw-*` token stylesheets. The service
 * owns the live theme preference (light/dark/system), resolves `system` through
 * `prefers-color-scheme`, and publishes immutable snapshots; it never touches
 * the DOM — ui-layout's presenter consumes the resolved snapshot. The Host
 * settings scope loads and stores the preference in the user-settings
 * document. The plugin registers the dedicated Appearance settings section
 * (nav row 外观与皮肤) holding the HLN v3.2 selection row (theme / font /
 * CJK font / background preset) and the conversation font-size row — theme
 * switching, including the native light gallery themes, lives on the HLN
 * theme cards; the legacy light/dark/system appearance row is retired.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HlnAppearanceRow, type HlnRowInjected } from './HlnAppearanceRow.tsx'
import { createHlnRowStore } from './hln-store.ts'
import { hlnEn, hlnZh, type HlnKey } from './hln-locales.ts'
import type { FontSizeRowInjected } from './FontSizeRow.tsx'
import { FontSizeRow } from './FontSizeRow.tsx'
import { AppearanceSection } from './AppearanceSection.tsx'
import { createFontSizeRowStore } from './settings-store.ts'
import { installThemeStyles } from './styles.ts'
// The retired Appearance row keeps its dictionary module for the preserved
// component; its copy still feeds the font-size row, and only the type flows
// through here.
import { en, zh, type ThemeKey } from './locales.ts'
import {
  HLN_DEFAULT_SELECTION, HLN_SELECTION_KEY, HLN_THEMES, readHlnSelection, validateSelection,
  writeHlnSelection, type HlnSelection,
} from './hln-catalog.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  isThemePreference, THEME_PREFERENCE_FIELD, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from '../theme-settings.ts'

export type { AppearanceRowComponentProps, AppearanceRowInjected } from './AppearanceRow.tsx'
export type { AppearanceSectionComponentProps } from './AppearanceSection.tsx'
export { AppearanceSection } from './AppearanceSection.tsx'
export type { FontSizeRowComponentProps, FontSizeRowInjected } from './FontSizeRow.tsx'
export type { HlnRowComponentProps, HlnRowInjected } from './HlnAppearanceRow.tsx'
export type { AppearanceRowState, FontSizeRowState } from './settings-store.ts'
export type { ThemeKey } from './locales.ts'
export type { HlnKey } from './hln-locales.ts'
export type { HlnRowState } from './hln-store.ts'
export type { HlnSelection, HlnThemeInfo, HlnCjkFontId } from './hln-catalog.ts'
export {
  HLN_BG_MOTIONS, HLN_CJK_FONTS, HLN_DEFAULT_SELECTION, HLN_FONTS, HLN_SELECTION_KEY, HLN_THEMES,
  readHlnSelection, validateSelection, writeHlnSelection,
} from './hln-catalog.ts'
export { useHlnEnterMotion } from '@deepseek-ai/dsh-client-ui-primitives'
export type { HlnMotionPreset, HlnMotionVariant, HlnUiApi } from '@deepseek-ai/dsh-client-ui-primitives'
export type { ThemePreference, ThemeSettings } from '../theme-settings.ts'

/** Namespace owning the HLN selection row's copy. */
export const HLN_NS = 'settings.hln'

/** Namespace owning the font-size row's copy (the retired Appearance row's dictionary). */
export const SETTINGS_NS = 'settings.theme'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The retired Appearance row's copy (the component is kept compilable). */
    'settings.theme': ThemeKey
    /** The HLN selection settings row's copy. */
    'settings.hln': HlnKey
  }
}

/**
 * Shape of the shell's HLN shim (apps/web/public/hln-ui-v3.5/hln-v35-fix.js):
 * the official v3.5 catalog accessors over the `data-hln-*` attributes. The
 * settings row degrades to the catalog constants when the shim is absent (a
 * plugin tree hosted outside the CetusPrism web shell). The interface lives in
 * dsh-client-ui-primitives' `hln-motion` module and is re-exported here.
 */

/** Read the live selection off the shim, falling back to the stored/persisted one. */
function currentHlnSelection(): HlnSelection {
  const hln = typeof window === 'undefined' ? undefined : window.HLN
  if (hln === undefined) return readHlnSelection(typeof localStorage === 'undefined' ? undefined : localStorage)
  return {
    theme: hln.currentTheme(),
    font: hln.currentFont(),
    cjk: hln.currentCjkFont(),
    bgMotion: hln.currentBgMotion(),
  }
}

/** Apply one selection through the shim, then persist it for boot restore. */
function applyHlnSelection(selection: HlnSelection): HlnSelection {
  const applied: HlnSelection = validateSelection(selection)
  const hln = typeof window === 'undefined' ? undefined : window.HLN
  if (hln !== undefined) {
    hln.applyTheme(applied.theme)
    hln.applyFont(applied.font)
    hln.applyCjkFont(applied.cjk)
    hln.applyBgMotion(applied.bgMotion)
  }
  writeHlnSelection(typeof localStorage === 'undefined' ? undefined : localStorage, applied)
  return applied
}

/**
 * The HLN theme card is the only appearance control, so it also owns the base
 * palette: the gallery themes (alabaster-studio, bauhaus-compiler) need the
 * light `--dsw-*` base palette while the dark planes need the dark one —
 * without this sync the mapped aliases flip to one scheme while unmapped
 * surfaces keep the other, and the settings panel renders half dark, half
 * light with illegible labels. `setHlnTheme` therefore resolves the card's
 * color scheme through the theme registry, which persists it and re-projects
 * `body[data-ds-dark-theme]` via the presenter.
 * @param theme - the theme runtime whose preference the card drives.
 * @param id - the HLN theme id the card picked.
 * @returns the scheme the given HLN theme id resolves to.
 */
function hlnThemeScheme(theme: ThemeRuntime, id: string): 'light' | 'dark' | undefined {
  const theme_ = HLN_THEMES.find(entry => entry.id === id)
  if (theme_ === undefined) return undefined
  if (theme.getTheme().active.colorScheme !== theme_.colorScheme) theme.setTheme(theme_.colorScheme)
  return theme_.colorScheme
}

/** Theme token dictionary: --dsw-alias-* overrides keyed by variable name. */
export type ThemeTokens = Record<string, string>

/**
 * One override-layer token value: both palette modes are mandatory (repeat
 * the same value when the token is scheme-invariant) so an override never
 * goes illegible when the user switches to the other scheme.
 */
export interface ThemeTokenModes {
  /** Value applied while the light base palette is active. */
  light: string
  /** Value applied while the dark base palette is active. */
  dark: string
}

/** Override-layer dictionary: token names to per-mode value pairs. */
export type ThemeTokenOverrides = Record<string, ThemeTokenModes>

/** One selectable theme: id, dark/light semantics, and alias-token overrides. */
export interface ThemeDefinition {
  /** Theme id (the setTheme argument for concrete themes). */
  id: string
  /**
   * Which base palette this theme builds on. The presenter switches
   * `body[data-ds-dark-theme]` from this field — never from the id.
   */
  colorScheme: 'light' | 'dark'
  /** Alias-layer overrides applied as inline CSS variables over the base palette. */
  tokens: ThemeTokens
}

/** Immutable theme state published on every change. */
export interface ThemeSnapshot {
  /** The persisted preference (may be `system`). */
  preference: ThemePreference
  /** Conversation content font size in px (integer within FONT_SIZE_MIN..FONT_SIZE_MAX). */
  fontSize: number
  /**
   * The resolved active theme (`system` resolved via prefers-color-scheme)
   * with override layers folded into its tokens (seq order, later layers win
   * per-token; each value picked for the active color scheme).
   */
  active: ThemeDefinition
  /** Registered themes in registration order. */
  themes: readonly ThemeDefinition[]
  /** Monotonic change counter (registry or active changes). */
  revision: number
}

/** One theme token exposed to pre-definition Cordis inspection. */
export interface ThemeTokenInspection {
  /** Token name accepted by {@link ThemeService.overrideTokens}. */
  name: string
  /** Intended visual role. */
  description: string
  /** CSS value category. */
  valueType: string
  /** Whether override layers must supply both palette modes. */
  requiresLightAndDark: boolean
  /** CSS custom property consumed by UI styles. */
  cssVariable?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    theme: ThemeRuntime
  }
  interface Events {
    /**
     * Theme state changed (preference switched, registry updated, or the OS
     * color scheme changed while the preference is `system`).
     * @param snapshot - Current immutable theme snapshot.
     * @mode emit
     */
    'theme/change'(snapshot: ThemeSnapshot): void
  }
}

const BUILTIN_THEMES: readonly ThemeDefinition[] = Object.freeze([
  Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
  Object.freeze({ id: 'dark', colorScheme: 'dark' as const, tokens: Object.freeze({}) }),
])

const BUILTIN_INSPECT_TOKENS: readonly ThemeTokenInspection[] = Object.freeze([
  { name: '--dsw-alias-bg-base', description: 'Application base background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-base' },
  { name: '--dsw-alias-bg-layer-1', description: 'Primary raised surface background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-layer-1' },
  { name: '--dsw-alias-bg-layer-2', description: 'Secondary nested surface background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-layer-2' },
  { name: '--dsw-alias-bg-overlay', description: 'Overlay and popover background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-overlay' },
  { name: '--dsw-alias-border-l1', description: 'Primary subtle border.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-border-l1' },
  { name: '--dsw-alias-border-l2', description: 'Secondary stronger border.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-border-l2' },
  { name: '--dsw-alias-brand-primary', description: 'Primary brand accent.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-brand-primary' },
  { name: '--dsw-alias-label-primary', description: 'Primary text color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-label-primary' },
  { name: '--dsw-alias-label-secondary', description: 'Secondary text color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-label-secondary' },
  { name: '--dsw-alias-state-error-primary', description: 'Primary error state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-error-primary' },
  { name: '--dsw-alias-state-idle-primary', description: 'Primary inactive state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-idle-primary' },
  { name: '--dsw-alias-state-success-primary', description: 'Primary success state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-success-primary' },
  { name: '--dsw-alias-state-warn-primary', description: 'Primary warning state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-warn-primary' },
  { name: '--dsw-specific-sidebar-fill', description: 'Sidebar column and title-row background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-specific-sidebar-fill' },
])

/**
 * Read the font size the Host boot script wrote on `body` before any plugin
 * ran, so the initial snapshot matches first paint and ui-layout's presenter
 * does not flash the schema default while the settings read is in flight.
 * Non-browser runs and mounts without the boot script fall back to the
 * schema default; the durable settings adoption still lands afterwards.
 */
function bootstrapFontSize(): number {
  /* v8 ignore next -- needs a documentless run (node e2e booting the client tree), not constructible under jsdom */
  if (typeof document === 'undefined') return DEFAULT_FONT_SIZE
  const raw = document.body.style.getPropertyValue('--dsh-content-font-size')
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= FONT_SIZE_MIN && parsed <= FONT_SIZE_MAX
    ? parsed
    : DEFAULT_FONT_SIZE
}

/**
 * Theme registry and preference owner. `light`/`dark` are built in (the base
 * stylesheets carry both palettes); third-party themes register alias-layer
 * overrides. Reads go through {@link getTheme}; preference writes only
 * through {@link setTheme}; continuous sync only through the `theme/change`
 * event. {@link overrideTokens} stacks partial token layers over the active
 * theme without touching the registry.
 * The service holds the `prefers-color-scheme` media query (environment
 * sensing, not presentation) and re-emits when the OS scheme flips while the
 * preference is `system`.
 */
export class ThemeRuntime {
  private readonly ctx: ClientContext
  private readonly host: ConfigForm<ThemeSettings>
  private themes: ThemeDefinition[] = [...BUILTIN_THEMES]
  private preference: ThemePreference
  private fontSize: number = bootstrapFontSize()
  private revision = 0
  private snapshot: ThemeSnapshot
  private readonly media: MediaQueryList | undefined
  /** Override layers by source; seq (monotonic) is the stacking order. */
  private readonly overrides = new Map<string, { seq: number; tokens: ThemeTokenOverrides }>()
  private overrideSeq = 0

  /**
   * @param ctx - owning context (change events are emitted on it; the
   * media-query and scope listeners are released through ctx.effect on dispose).
   * @param host - durable preference scope owned by the same plugin.
   */
  constructor(ctx: ClientContext, host: ConfigForm<ThemeSettings>) {
    this.ctx = ctx
    this.host = host
    this.preference = DEFAULT_PREFERENCE
    // Non-browser runs (node e2e booting the client tree) have no matchMedia.
    this.media = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)')
    this.snapshot = this.buildSnapshot()
    if (this.media !== undefined) {
      const media = this.media
      const onChange = (): void => {
        if (this.preference !== 'system') return
        this.publish()
      }
      ctx.effect(() => {
        media.addEventListener('change', onChange)
        return () => { media.removeEventListener('change', onChange) }
      }, 'ui-theme: prefers-color-scheme listener')
    }
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-theme: settings scope adoption')
    this.adopt()
  }

  /**
   * Read the current immutable theme snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  getTheme(): ThemeSnapshot {
    return this.snapshot
  }

  /**
   * Export the current token directory without reading DOM or computed styles.
   * @returns stable JSON-safe token descriptions, including registered and override-only names.
   */
  exportInspectTokens(): ThemeTokenInspection[] {
    const tokens = new Map(BUILTIN_INSPECT_TOKENS.map(token => [token.name, token]))
    for (const theme of this.themes) {
      for (const name of Object.keys(theme.tokens)) {
        if (!tokens.has(name)) tokens.set(name, dynamicToken(name))
      }
    }
    for (const layer of this.overrides.values()) {
      for (const name of Object.keys(layer.tokens)) {
        if (!tokens.has(name)) tokens.set(name, dynamicToken(name))
      }
    }
    return [...tokens.values()].map(token => ({ ...token })).sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Switch the theme preference — the only user preference write entry.
   * Built-in preferences are written through the settings scope and every
   * accepted value emits `theme/change`.
   * @param id - a registered theme id or `system`; unknown ids throw.
   */
  setTheme(id: string): void {
    if (id !== 'system' && !this.themes.some(t => t.id === id)) {
      throw new Error(`theme "${id}" is not registered`)
    }
    if (this.preference === id) return
    this.preference = id as ThemePreference
    if (isThemePreference(id)) void this.host.set(THEME_PREFERENCE_FIELD, id)
    this.publish()
  }

  /**
   * Change the conversation content font size — the only font-size write
   * entry. Accepted values are written through the settings scope and emit
   * `theme/change`.
   * @param px - integer px within FONT_SIZE_MIN..FONT_SIZE_MAX; out-of-range or fractional values throw.
   */
  setFontSize(px: number): void {
    if (!Number.isInteger(px) || px < FONT_SIZE_MIN || px > FONT_SIZE_MAX) {
      throw new Error(`font size ${px} is outside ${FONT_SIZE_MIN}..${FONT_SIZE_MAX}`)
    }
    if (this.fontSize === px) return
    this.fontSize = px
    void this.host.set(FONT_SIZE_FIELD, px)
    this.publish()
  }

  /** Adopt the scope's accepted durable preference without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    if (this.preference === section.preference && this.fontSize === section.fontSize) return
    this.preference = section.preference
    this.fontSize = section.fontSize
    this.publish()
  }

  /**
   * Register a theme. Duplicate id throws (single occupant per id; the
   * built-in pair counts; `system` is a preference, not a registrable id).
   * @param definition - theme id, colorScheme, and alias-token overrides.
   * @returns disposer. Disposing the theme backing the active preference
   * resets the preference to the default so the UI never keeps tokens of an
   * unregistered theme.
   */
  register(definition: ThemeDefinition): () => void {
    if (definition.id === 'system') throw new Error('"system" is a preference, not a registrable theme id')
    if (this.themes.some(t => t.id === definition.id)) {
      throw new Error(`theme "${definition.id}" is already registered`)
    }
    this.themes = [...this.themes, definition]
    this.publish()
    return () => {
      if (!this.themes.some(t => t.id === definition.id)) return
      this.themes = this.themes.filter(t => t.id !== definition.id)
      if (this.preference === definition.id) {
        this.preference = DEFAULT_PREFERENCE
      }
      this.publish()
    }
  }

  /**
   * Stack a token override layer on top of the active theme — the token-level
   * analogue of slot shading: the base theme stays untouched, layers compose
   * in seq order with later layers winning per-token, and removing a layer
   * restores whatever it covered. Calling again with the same source replaces
   * that source's whole layer and restacks it on top (effect re-registration
   * semantics). Emits `theme/change` with the recomposed snapshot.
   * @param source - layer identity; one layer per source (dynamic packages
   * pass their package id — the façade pins it, so it also names the layer's
   * origin for inspection).
   * @param tokens - token-name → `{ light, dark }` value pairs. Validated at
   * runtime (model-authored callers reach this boundary with untyped JS);
   * a bare string value throws a teaching error.
   * @returns disposer removing exactly the layer this call created; a no-op
   * once the source has re-overridden (the newer layer is not torn down).
   */
  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void {
    const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) }
    this.overrides.set(source, layer)
    this.publish()
    return () => {
      if (this.overrides.get(source) !== layer) return
      this.overrides.delete(source)
      this.publish()
    }
  }

  private buildSnapshot(): ThemeSnapshot {
    const resolvedId = this.preference === 'system'
      ? (this.media?.matches === true ? 'dark' : 'light')
      : this.preference
    // Both built-ins always exist; a registered preference id resolves or has
    // been reset by its disposer, so the lookup cannot miss.
    const active = this.themes.find(t => t.id === resolvedId)
    /* v8 ignore next 2 -- needs a registry without light/dark, which register()/dispose() cannot produce */
    if (active === undefined) throw new Error(`theme registry lost "${resolvedId}"`)
    return Object.freeze({
      preference: this.preference,
      fontSize: this.fontSize,
      active: this.composeActive(active),
      themes: Object.freeze([...this.themes]),
      revision: this.revision,
    })
  }

  /**
   * Fold the override layers into the active definition: seq order, later
   * layers win per-token, each value picked for the active color scheme (the
   * presenter consumes the composed snapshot and needs no override awareness).
   * Without layers the registered definition passes through by identity.
   */
  private composeActive(active: ThemeDefinition): ThemeDefinition {
    if (this.overrides.size === 0) return active
    const tokens: ThemeTokens = { ...active.tokens }
    for (const layer of [...this.overrides.values()].sort((a, b) => a.seq - b.seq)) {
      for (const [name, modes] of Object.entries(layer.tokens)) {
        tokens[name] = modes[active.colorScheme]
      }
    }
    return Object.freeze({ ...active, tokens: Object.freeze(tokens) })
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = this.buildSnapshot()
    this.ctx.emit('theme/change', this.snapshot)
  }
}

/**
 * Runtime shape check for one override layer (model-authored callers pass
 * untyped JS through the dynamic-package façade, so the static type cannot
 * enforce the pair shape there). Returns a defensive per-token copy so later
 * caller mutation cannot reach the stored layer.
 */
function validateOverrides(source: string, tokens: ThemeTokenOverrides): ThemeTokenOverrides {
  const validated: ThemeTokenOverrides = {}
  for (const [name, value] of Object.entries<unknown>(tokens)) {
    if (typeof value === 'string') {
      throw new TypeError(
        `theme override "${name}" from "${source}" is a bare string — pass { light: ${JSON.stringify(value)}, dark: ${JSON.stringify(value)} } `
        + '(repeat the value when it is the same in both palettes); a single value goes illegible when the user switches color scheme',
      )
    }
    if (typeof value !== 'object' || value === null
      || typeof (value as { light?: unknown }).light !== 'string'
      || typeof (value as { dark?: unknown }).dark !== 'string') {
      throw new TypeError(
        `theme override "${name}" from "${source}" must map to a { light, dark } pair of strings — one value per color scheme`,
      )
    }
    const modes = value as ThemeTokenModes
    validated[name] = { light: modes.light, dark: modes.dark }
  }
  return validated
}

function dynamicToken(name: string): ThemeTokenInspection {
  return {
    name,
    description: 'Theme token registered by the current Client composition.',
    valueType: 'CSS value',
    requiresLightAndDark: true,
    ...(name.startsWith('--') ? { cssVariable: name } : {}),
  }
}

/**
 * Required services: settings transport plus slots/locale for the HLN
 * selection row and the font-size row. `remote` carries the forwarded settings
 * invalidation that `ctx.configForms.get(entryId)` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'remote', 'configForms']

/**
 * Client plugin body: provide the theme service, mount the global theme
 * sheets for the plugin lifetime, and register the dedicated Appearance
 * settings section (皮肤/主题 page) with the HLN v3.2 selection row
 * (theme / font / CJK font / background preset) and the conversation
 * font-size row as its items — a feature owns its settings surface. Theme
 * switching, including the native light gallery themes, happens on the HLN
 * theme cards; the legacy light/dark/system Appearance row is not registered.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  installThemeStyles(ctx)
  const host = ctx.configForms.get<ThemeSettings>(THEME_SETTINGS_NAMESPACE)
  const theme = new ThemeRuntime(ctx, host)
  ctx.provide('theme', theme)

  // Reconcile the base palette with a persisted HLN theme selection. Rounds
  // before the scheme-sync write existed could leave a light gallery theme
  // (alabaster-studio, bauhaus-compiler) selected over the dark base palette — the
  // mixed-surface state where mapped aliases flip light while unmapped
  // surfaces stay dark. Runs only when an HLN record exists, so a legacy
  // light/dark preference the HLN cards never touched still stands.
  const storedRaw = typeof localStorage === 'undefined' ? null : (() => {
    try { return localStorage.getItem(HLN_SELECTION_KEY) } catch { return null }
  })()
  if (storedRaw !== null) {
    const stored = HLN_THEMES.find(t => t.id === readHlnSelection(localStorage).theme)
    if (stored !== undefined && theme.getTheme().active.colorScheme !== stored.colorScheme) {
      theme.setTheme(stored.colorScheme)
    }
  }

  ctx.effect(() => ctx.locale.register(HLN_NS, { zh: hlnZh, en: hlnEn }), 'ui-theme: hln row dictionaries')
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: font-size row dictionary')

  const hlnStore = createHlnRowStore()
  let hlnBound: BoundActions<typeof hlnStore> | undefined
  // The last known live selection: the shim's boot state at inject time, then
  // each applied write. It is the merge base for single-field writes so a
  // write never reverts the fields a previous write applied (the shim-less
  // lane has no DOM or storage to re-read them from).
  let hlnLive: HlnSelection = { ...HLN_DEFAULT_SELECTION }
  const syncHln = (selection: HlnSelection): void => {
    hlnLive = selection
    hlnBound?.set(selection)
  }
  const hlnInjected = (actions: BoundActions<typeof hlnStore>): HlnRowInjected => {
    hlnBound = actions
    // Mirror the selection the shim already applied at boot so the first
    // render shows the live state, not the catalog defaults.
    syncHln(currentHlnSelection())
    return {
      setHlnTheme: (id) => {
        hlnThemeScheme(theme, id)
        syncHln(applyHlnSelection({ ...hlnLive, theme: id }))
      },
      setHlnFont: (id) => { syncHln(applyHlnSelection({ ...hlnLive, font: id })) },
      setHlnCjk: (id) => { syncHln(applyHlnSelection({ ...hlnLive, cjk: id })) },
      setHlnBgMotion: (id) => { syncHln(applyHlnSelection({ ...hlnLive, bgMotion: id })) },
    }
  }
  ctx.slots.inject('settings.appearance.item', () => ctx.slots.register({
    name: 'settings.appearance.item',
    id: 'hln-appearance',
    order: 11,
    store: hlnStore,
    locale: HLN_NS,
    inject: hlnInjected,
  }, HlnAppearanceRow))

  const fontSizeStore = createFontSizeRowStore()
  let fontSizeBound: BoundActions<typeof fontSizeStore> | undefined
  ctx.on('theme/change', (snapshot) => {
    fontSizeBound?.sync(snapshot.fontSize, snapshot.revision)
  })
  const fontSizeInjected = (actions: BoundActions<typeof fontSizeStore>): FontSizeRowInjected => {
    fontSizeBound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    const initial = theme.getTheme()
    fontSizeBound.sync(initial.fontSize, initial.revision)
    return {
      setFontSize: (px) => { theme.setFontSize(px) },
    }
  }
  ctx.slots.inject('settings.appearance.item', () => ctx.slots.register({
    name: 'settings.appearance.item',
    id: 'font-size',
    order: 12,
    store: fontSizeStore,
    locale: SETTINGS_NS,
    inject: fontSizeInjected,
  }, FontSizeRow))

  // The theme feature owns its own settings page: the nav row and the item
  // column are one registration, so the section exists exactly while the
  // theme rows do.
  const t = ctx.locale.bind(SETTINGS_NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'appearance',
    order: -5,
    label: () => t('appearance.nav'),
    locale: SETTINGS_NS,
    children: { 'settings.appearance.item': { kind: 'list', scope: 'root' } },
  }, AppearanceSection))
}
