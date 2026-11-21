/**
 * HLN UI System v4 selection row, registered into the Appearance settings
 * section's item slot: unified themes (pairing dual-pigment palettes with
 * cohesive typography and ambient surfaces), along with fine-tuning panels
 * for Latin fonts, CJK fonts, and background presets.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useHlnEnterMotion } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  HLN_BG_MOTIONS, HLN_CJK_FONTS, HLN_FONTS, HLN_FONT_VARIABLES, HLN_THEMES,
  type HlnBgMotionId, type HlnCjkFontId, type HlnThemeId,
} from './hln-catalog.ts'
import type { HlnKey } from './hln-locales.ts'
import type { createHlnRowStore } from './hln-store.ts'
import css from './HlnAppearanceRow.module.css'

/** Injected business face: the four selection writes (t rides the standard locale seat). */
export interface HlnRowInjected {
  /** Apply an HLN theme (`body[data-hln-theme]`). */
  setHlnTheme: (id: string) => void
  /** Apply an HLN font mode (`body[data-hln-font]`). */
  setHlnFont: (id: string) => void
  /** Apply a CJK font mode (`data-hln-cjk-font`). */
  setHlnCjk: (id: string) => void
  /** Apply a background preset (`#root[data-hln-bg-motion]`). */
  setHlnBgMotion: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type HlnRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createHlnRowStore>>
  & PropsLocale<'settings.hln'> & HlnRowInjected

/** Catalog id → locale key for the theme card labels. */
const THEME_LABEL: Record<HlnThemeId, HlnKey> = {
  'folio-graphite': 'theme.folio-graphite',
  'folio-porcelain': 'theme.folio-porcelain',
  'folio-pine': 'theme.folio-pine',
  'folio-slate': 'theme.folio-slate',
  'folio-apricot': 'theme.folio-apricot',
  'folio-plum': 'theme.folio-plum',
  'folio-sage': 'theme.folio-sage',
  'folio-lilac': 'theme.folio-lilac',
  'singularity-cyan': 'theme.singularity-cyan',
  'tensor-amber': 'theme.tensor-amber',
  'veridian-stream': 'theme.veridian-stream',
  'synapse-violet': 'theme.synapse-violet',
  'cobalt-manifold': 'theme.cobalt-manifold',
  'titanium-oxide': 'theme.titanium-oxide',
  'alabaster-studio': 'theme.alabaster-studio',
  'bauhaus-compiler': 'theme.bauhaus-compiler',
}

/** Catalog id → locale key for the CJK font card labels. */
const CJK_LABEL: Record<HlnCjkFontId, HlnKey> = {
  auto: 'cjk.auto',
  hei: 'cjk.hei',
  display: 'cjk.display',
  song: 'cjk.song',
  kai: 'cjk.kai',
  mono: 'cjk.mono',
  fangsong: 'cjk.fangsong',
}

/** Catalog id → locale key for the background-preset card labels. */
const MOTION_LABEL: Record<HlnBgMotionId, HlnKey> = {
  'tensor-stream': 'motion.tensor-stream',
  'neural-dag': 'motion.neural-dag',
  'fourier-harmonics': 'motion.fourier-harmonics',
  'procedural-matrix': 'motion.procedural-matrix',
  'simplex-contour': 'motion.simplex-contour',
  'clock-bus': 'motion.clock-bus',
  'swiss-vector': 'motion.swiss-vector',
  'paper-grain': 'motion.paper-grain',
  'margin-rule': 'motion.margin-rule',
  'tint-wash': 'motion.tint-wash',
  'ruled-lines': 'motion.ruled-lines',
  'folio-grid': 'motion.folio-grid',
  'vellum-fiber': 'motion.vellum-fiber',
  quiet: 'motion.quiet',
}

/** Numbered catalog panel using the shell's KalciriteUI v4 primitives. */
function CatalogPanel({ title, index, children }: { title: string; index: string; children: ReactNode }) {
  return (
    <section className={clsx('hln-v35-panel', css.panel)} data-hln-ui-surface="panel">
      <div className="hln-v35-panel__head">
        <div className="hln-v35-panel__title">
          <span className="hln-v35-panel__index" aria-hidden="true">{index}</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className={css.cardGrid} role="group" aria-label={title}>{children}</div>
    </section>
  )
}

/**
 * Render the HLN selection row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function HlnAppearanceRow(
  { t, useStore, setHlnTheme, setHlnFont, setHlnCjk, setHlnBgMotion }: HlnRowComponentProps,
) {
  const selection = useStore(s => s)
  const motionScope = useHlnEnterMotion('item')
  return (
    <div className={css.group} data-hln-appearance ref={motionScope}>
      <div className={css.title}>{t('hln.title')}</div>

      <CatalogPanel title={t('hln.theme')} index="01">
        {HLN_THEMES.map(theme => (
          <button
            key={theme.id}
            type="button"
            className={clsx(css.card, css.themeCard)}
            data-hln-ui-control
            data-hln-motion="item"
            data-active={selection.theme === theme.id}
            aria-pressed={selection.theme === theme.id}
            onClick={() => {
              setHlnTheme(theme.id)
              setHlnFont(theme.defaultFont)
              setHlnCjk(theme.defaultCjk)
              setHlnBgMotion(theme.defaultBgMotion)
            }}
          >
            <span className={css.swatchPair} aria-hidden="true">
              <span className={css.swatchShade} style={{ background: theme.swatch }} />
              <span className={css.swatchAccent} style={{ background: theme.accent }} />
              <span className={css.swatchAccentCool} style={{ background: theme.accentCool }} />
            </span>
            <span className={css.themeInfo}>
              <span className={css.cardLabel}>{t(THEME_LABEL[theme.id])}</span>
              <span className={css.metaRow} aria-hidden="true">
                <span className={css.schemeBadge}>{theme.colorScheme}</span>
                <span className={css.fontBadge}>{theme.defaultFont}</span>
              </span>
            </span>
          </button>
        ))}
      </CatalogPanel>

      <CatalogPanel title={t('hln.font')} index="02">
        {HLN_FONTS.map(font => (
          <button
            key={font}
            type="button"
            className={clsx(css.card, css.fontCard)}
            data-hln-ui-control
            data-hln-motion="item"
            data-active={selection.font === font}
            style={{ fontFamily: `var(${HLN_FONT_VARIABLES[font]}, inherit)` }}
            aria-pressed={selection.font === font}
            onClick={() => { setHlnFont(font) }}
          >
            <span className={css.cardLabel}>{font}</span>
            <span className={css.fontSample} aria-hidden="true">字A</span>
          </button>
        ))}
      </CatalogPanel>

      <CatalogPanel title={t('hln.cjk')} index="03">
        {HLN_CJK_FONTS.map(cjk => (
          <button
            key={cjk}
            type="button"
            className={css.card}
            data-hln-ui-control
            data-hln-motion="item"
            data-active={selection.cjk === cjk}
            aria-pressed={selection.cjk === cjk}
            onClick={() => { setHlnCjk(cjk) }}
          >
            <span className={css.cardLabel}>{t(CJK_LABEL[cjk])}</span>
          </button>
        ))}
      </CatalogPanel>

      <CatalogPanel title={t('hln.bg')} index="04">
        {HLN_BG_MOTIONS.map(motion => (
          <button
            key={motion}
            type="button"
            className={css.card}
            data-hln-ui-control
            data-hln-motion="item"
            data-active={selection.bgMotion === motion}
            aria-pressed={selection.bgMotion === motion}
            onClick={() => { setHlnBgMotion(motion) }}
          >
            <span className={css.cardLabel}>{t(MOTION_LABEL[motion])}</span>
          </button>
        ))}
      </CatalogPanel>
    </div>
  )
}
