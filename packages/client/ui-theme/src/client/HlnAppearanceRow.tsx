/**
 * HLN UI System v3.5 selection row, registered into the Appearance settings
 * section's item slot: theme (the eight official v3.5 planes, including the
 * two native light themes), font (eight type modes), CJK font (seven hanzi
 * modes), and background preset (eight algorithmic planes), each a card grid
 * in the CetusPrism settings style. Applying goes through the shell's
 * `window.HLN` engine; the choice persists locally and is restored by the
 * same shim on boot.
 */
import clsx from 'clsx'
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
  quiet: 'motion.quiet',
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
  return (
    <div className={css.group}>
      <div className={css.title}>{t('hln.title')}</div>

      <div className={css.groupLabel}>{t('hln.theme')}</div>
      <div className={css.cardGrid} role="group" aria-label={t('hln.theme')}>
        {HLN_THEMES.map(theme => (
          <button
            key={theme.id}
            type="button"
            className={css.card}
            aria-pressed={selection.theme === theme.id}
            onClick={() => { setHlnTheme(theme.id) }}
          >
            <span className={css.swatchPair} aria-hidden="true">
              <span className={css.swatchShade} style={{ background: theme.swatch }} />
              <span className={css.swatchAccent} style={{ background: theme.accent }} />
            </span>
            <span className={css.cardLabel}>{t(THEME_LABEL[theme.id])}</span>
          </button>
        ))}
      </div>

      <div className={css.groupLabel}>{t('hln.font')}</div>
      <div className={css.cardGrid}>
        {HLN_FONTS.map(font => (
          <button
            key={font}
            type="button"
            className={clsx(css.card, css.fontCard)}
            style={{ fontFamily: `var(${HLN_FONT_VARIABLES[font]}, inherit)` }}
            aria-pressed={selection.font === font}
            onClick={() => { setHlnFont(font) }}
          >
            <span className={css.cardLabel}>{font}</span>
            <span className={css.fontSample} aria-hidden="true">字A</span>
          </button>
        ))}
      </div>

      <div className={css.groupLabel}>{t('hln.cjk')}</div>
      <div className={css.cardGrid} role="group" aria-label={t('hln.cjk')}>
        {HLN_CJK_FONTS.map(cjk => (
          <button
            key={cjk}
            type="button"
            className={css.card}
            aria-pressed={selection.cjk === cjk}
            onClick={() => { setHlnCjk(cjk) }}
          >
            <span className={css.cardLabel}>{t(CJK_LABEL[cjk])}</span>
          </button>
        ))}
      </div>

      <div className={css.groupLabel}>{t('hln.bg')}</div>
      <div className={css.cardGrid} role="group" aria-label={t('hln.bg')}>
        {HLN_BG_MOTIONS.map(motion => (
          <button
            key={motion}
            type="button"
            className={css.card}
            aria-pressed={selection.bgMotion === motion}
            onClick={() => { setHlnBgMotion(motion) }}
          >
            <span className={css.cardLabel}>{t(MOTION_LABEL[motion])}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
