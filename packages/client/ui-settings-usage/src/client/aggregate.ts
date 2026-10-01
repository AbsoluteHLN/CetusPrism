/**
 * Pure fold from the client Session list store into the usage aggregate:
 * per-session token buckets (token-meter's `tokenUsage` projection), the daily
 * trend (token-meter's `usageTimeline`), and conversation figures
 * (`sessionStats`), summed across every visible row.
 *
 * The fold reads the wire projection values defensively: a value the current
 * fold semantics did not produce reads as uncounted, never as zero-asserted.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-usage/client
 */

import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
// Type-only: loads the token-meter namespace augmentations this fold reads.
import type { UsageTimelineDay } from '@deepseek-ai/dsh-token-meter/client'

/** One per-session table row; billed input collapses cache traffic into one figure. */
export interface UsageRow {
  readonly sessionId: SessionId
  readonly title: string
  /** Last activity timestamp (0 for rows without a recorded activity). */
  readonly updatedAt: number
  /** Subagent rows bill like ordinary sessions but read differently in the table. */
  readonly subagent: boolean
  /** Closed turns, when the session carries the `sessionStats` projection. */
  readonly turns: number | undefined
  /** Uncached input + cache reads + cache writes. */
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
}

/** The section's whole data model: bucket totals, coverage, rows largest-total first, and the daily timeline. */
export interface UsageAggregate {
  readonly sessionsTotal: number
  readonly sessionsCounted: number
  /** Billed input: uncached prompt tokens plus cache reads and writes. */
  readonly inputTokens: number
  /** Provider-reported cache reads, also included in `inputTokens`. */
  readonly cacheReadTokens: number
  /** Provider-reported cache writes, also included in `inputTokens`. */
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly turns: number
  readonly llmMs: number
  readonly rows: readonly UsageRow[]
  /** Per-day usage summed across every visible row, ascending by day (token-meter's `usageTimeline`). */
  readonly timeline: readonly UsageTimelineDay[]
}

/** The members of a Session list row this fold reads. */
export interface UsageSessionRow {
  readonly displayTitle: string
  readonly updatedAt: number
  readonly origin?: 'subagent'
  readonly projectionValues?: Readonly<Partial<SessionProjectionMap>> | undefined
}

/** Merge one row's day entry into the per-day accumulator, summing every bucket. */
function addTimelineDay(days: Map<number, UsageTimelineDay>, entry: UsageTimelineDay): void {
  const existing = days.get(entry.day)
  days.set(entry.day, {
    day: entry.day,
    uncachedInputTokens: (existing?.uncachedInputTokens ?? 0) + entry.uncachedInputTokens,
    outputTokens: (existing?.outputTokens ?? 0) + entry.outputTokens,
    cacheReadTokens: (existing?.cacheReadTokens ?? 0) + entry.cacheReadTokens,
    cacheWriteTokens: (existing?.cacheWriteTokens ?? 0) + entry.cacheWriteTokens,
  })
}

/**
 * Fold every visible Session row's projections into the usage aggregate.
 *
 * Rows without a `tokenUsage` value (sessions the projection cache has not
 * seen, or sessions that never reached the model) stay uncounted and surface
 * only in the coverage figures. The timeline folds independently of that
 * gate: every row carrying a `usageTimeline` value contributes its days.
 * @param state - by-id Session rows from the Session list store snapshot.
 * @returns the aggregate with rows sorted by total tokens, largest first.
 */
export function aggregateUsage(state: {
  byId: Readonly<Record<SessionId, UsageSessionRow>>
}): UsageAggregate {
  let sessionsTotal = 0
  let sessionsCounted = 0
  let turns = 0
  let llmMs = 0
  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  const timelineDays = new Map<number, UsageTimelineDay>()
  const rows: UsageRow[] = []
  for (const [sessionId, summary] of Object.entries(state.byId)) {
    sessionsTotal += 1
    const timeline = summary.projectionValues?.usageTimeline
    if (timeline !== undefined) {
      for (const day of timeline.days) addTimelineDay(timelineDays, day)
    }
    const usage = summary.projectionValues?.tokenUsage
    if (usage === undefined) continue
    sessionsCounted += 1
    inputTokens += usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    cacheReadTokens += usage.cacheReadTokens
    cacheWriteTokens += usage.cacheWriteTokens
    outputTokens += usage.outputTokens
    const stats = summary.projectionValues?.sessionStats
    if (stats !== undefined) {
      turns += stats.turns
      llmMs += stats.llmMs
    }
    rows.push({
      sessionId: SessionId(sessionId),
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      subagent: summary.origin === 'subagent',
      turns: stats?.turns,
      inputTokens: usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheReadTokens + usage.cacheWriteTokens,
    })
  }
  rows.sort((left, right) =>
    (right.inputTokens + right.outputTokens) - (left.inputTokens + left.outputTokens)
    || right.updatedAt - left.updatedAt)
  return {
    sessionsTotal, sessionsCounted, turns, llmMs,
    inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
    rows,
    timeline: [...timelineDays.values()].sort((left, right) => left.day - right.day),
  }
}
