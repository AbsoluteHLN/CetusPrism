/**
 * The About & acknowledgements section: the distribution's own version, the
 * harness core build it embeds, the upstream credit, and the non-affiliation
 * statement. Pure build metadata from the client build environment — no Host
 * calls, no subscriptions.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useHlnEnterMotion } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AboutSection.module.css'

/** Full component props: section runtime share + locale seat. */
export type AboutSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.about'>

/** Upstream repository the credit links to. */
const UPSTREAM_REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness'

/** Complete-build core version label; absent on partial builds. */
function coreBuildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version + (commit === undefined ? '' : `-${commit}`)
}

/**
 * Render the About & acknowledgements section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AboutSection({ t }: AboutSectionProps) {
  const productVersion = process.env.DSH_CLIENT_PRODUCT_VERSION
  const coreVersion = coreBuildVersion()
  // The shell's v3.2 enter motion plays over the section's cards; without the
  // shim (outside the CetusPrism web shell) this is inert.
  const motionScope = useHlnEnterMotion('panel')
  return (
    <div className={css.section} data-hln-motion="panel" ref={motionScope}>
      <div className={css.card}>
        <div className={css.productRow}>
          <span className={css.productName}>{t('product.title')}</span>
          {productVersion !== undefined && (
            <span className={css.productVersion} data-testid="product-version">
              {t('product.version')} {productVersion}
            </span>
          )}
        </div>
        <span className={css.channelTag}>{t('product.channel')}</span>
      </div>
      {coreVersion !== undefined && (
        <div className={css.card}>
          <span className={css.cardTitle}>{t('core.title')}</span>
          <div className={css.metaRow}>
            <span className={css.metaLabel}>{t('core.version')}</span>
            <span className={css.metaValue} data-testid="core-version">{coreVersion}</span>
          </div>
        </div>
      )}
      <div className={css.card}>
        <span className={css.cardTitle}>{t('credit.title')}</span>
        <p className={css.creditBody}>{t('credit.body')}</p>
        <div className={css.metaRow}>
          <span className={css.metaLabel}>{t('credit.license')}</span>
          <a className={css.repoLink} href={UPSTREAM_REPO_URL} target="_blank" rel="noopener noreferrer">
            {t('credit.repo')}
          </a>
        </div>
      </div>
      <div className={css.card}>
        <span className={css.cardTitle}>{t('legal.title')}</span>
        <p className={css.creditBody}>{t('legal.disclaimer')}</p>
        <p className={css.creditBody}>{t('legal.license')}</p>
      </div>
    </div>
  )
}
