/**
 * The Usage settings section: corpus-wide token accounting folded from the
 * Session list's projections (token-meter's `tokenUsage` buckets, the
 * `usageTimeline` daily trend, and the `sessionStats` conversation figures).
 * Read-only: the section renders what the durable logs recorded and invents
 * nothing — sessions without a `tokenUsage` value stay uncounted and surface
 * in the coverage figure.
 */
import { useMemo } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useHlnEnterMotion } from '@deepseek-ai/dsh-client-ui-primitives'
import { aggregateUsage } from './aggregate.ts'
import { formatTokens, type UsageTranslate } from './format.ts'
import { UsageChart } from './UsageChart.tsx'
import css from './UsageSection.module.css'

/** Registration-side inject face: the Session list store, observed through the framework hook. */
export interface UsageSectionInjected {
  hooks: {
    sessions: HostObservable<SessionListState>
  }
}

/** Full component props: section runtime share + locale seat + injected face. */
export type UsageSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.usage'> & InjectFace<UsageSectionInjected>

/** Cap the table so a large corpus renders a bounded column; totals stay whole. */
const TABLE_ROW_LIMIT = 50

/** Wall-clock figure: hours+minutes, minutes+seconds, or seconds. */
function formatDuration(ms: number, t: UsageTranslate): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return t('duration.s', { seconds: totalSeconds })
  if (totalSeconds < 3600) {
    return t('duration.ms', { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 })
  }
  return t('duration.hms', { hours: Math.floor(totalSeconds / 3600), minutes: Math.floor((totalSeconds % 3600) / 60) })
}

/**
 * Render the Usage section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function UsageSection({ useSessions, t }: UsageSectionProps) {
  const state = useSessions(value => value)
  const aggregate = useMemo(() => aggregateUsage(state), [state])
  if (aggregate.sessionsCounted === 0) {
    return (
      <div className={css.section}>
        <div className={css.empty}>{t('empty')}</div>
      </div>
    )
  }
  const rows = aggregate.rows.slice(0, TABLE_ROW_LIMIT)
  // The shell's v3.2 enter motion plays over the section's cards, chart, and
  // table; without the shim (outside the CetusPrism web shell) this is inert.
  const motionScope = useHlnEnterMotion('panel')
  return (
    <div className={css.section} data-hln-motion="panel" ref={motionScope}>
      <div className={css.cards}>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('input')}</span>
          <span className={css.cardValue}>{formatTokens(aggregate.inputTokens, t)}</span>
          <span className={css.cardHint}>{t('input.hint', {
            count: formatTokens(aggregate.inputTokens - aggregate.cacheReadTokens - aggregate.cacheWriteTokens, t),
            read: formatTokens(aggregate.cacheReadTokens, t),
            write: formatTokens(aggregate.cacheWriteTokens, t),
          })}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('output')}</span>
          <span className={css.cardValue}>{formatTokens(aggregate.outputTokens, t)}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('total')}</span>
          <span className={css.cardValue}>{formatTokens(aggregate.inputTokens + aggregate.outputTokens, t)}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('modelTime')}</span>
          <span className={css.cardValue}>{formatDuration(aggregate.llmMs, t)}</span>
          <span className={css.cardHint}>{t('turns', { count: aggregate.turns })}</span>
        </div>
      </div>
      <UsageChart timeline={aggregate.timeline} t={t} />
      <div className={css.table}>
        <div className={css.head} aria-hidden="true">
          <span>{t('column.session')}</span>
          <span>{t('column.input')}</span>
          <span>{t('column.output')}</span>
          <span>{t('column.cache')}</span>
          <span>{t('column.total')}</span>
        </div>
        {rows.map(row => (
          <div key={row.sessionId} className={css.row}>
            <span className={css.sessionTitle}>
              <span className={css.sessionName}>{row.title}</span>
              {row.subagent && <span className={css.subagentTag}>{t('subagent')}</span>}
            </span>
            <span>{formatTokens(row.inputTokens, t)}</span>
            <span>{formatTokens(row.outputTokens, t)}</span>
            <span className={css.cellMuted}>{formatTokens(row.cacheTokens, t)}</span>
            <span>{formatTokens(row.inputTokens + row.outputTokens, t)}</span>
          </div>
        ))}
      </div>
      <span className={css.coverage}>
        {t('coverage', { counted: aggregate.sessionsCounted, total: aggregate.sessionsTotal })}
      </span>
    </div>
  )
}
