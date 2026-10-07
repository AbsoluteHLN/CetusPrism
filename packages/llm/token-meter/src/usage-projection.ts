/**
 * Pure folds for durable provider-reported token usage and context occupancy.
 */

import { z } from 'zod'
import { lastAssistantStreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ContextPressureProjection, TokenUsageProjection, UsageTimelineDay } from './projection.ts'
import { foldSurfaceProjection } from './surface-projection.ts'

const zeroBuckets = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

const bucketsFrom = (usage: TokenUsage): TokenUsageProjection => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const bucketsEqual = (left: TokenUsageProjection, right: TokenUsageProjection): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

const addReplacing = (
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
})

const projectionSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

/**
 * The token-usage unit's state schema — the one definition of the state
 * shape; the state type is inferred from it.
 */
const tokenUsageStateSchema = z.object({
  // Fork boundary: events below it belong to the source session's history
  // and their usage was already billed there.
  forkBoundary: z.number().int().nonnegative(),
  totals: projectionSchema,
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    buckets: projectionSchema,
  }).nullable(),
}).strict()

type TokenUsageState = z.infer<typeof tokenUsageStateSchema>

const pressureSchema: z.ZodType<ContextPressureProjection> = z.object({
  pressureTokens: z.number().int().nonnegative().optional(),
  projectedTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional(),
}).strict().transform(({ pressureTokens, projectedTokens, contextWindow }) => ({
  ...pressureTokens === undefined ? {} : { pressureTokens },
  ...projectedTokens === undefined ? {} : { projectedTokens },
  ...contextWindow === undefined ? {} : { contextWindow },
}))

/** Prompt-side pressure of one request: input plus cache traffic, no output. */
const pressureFrom = (usage: TokenUsage): number =>
  usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

/** The usage one durable Assistant settlement reports for its attempt, if any. */
function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    tokenUsage: TokenUsageState
    contextPressure: ContextPressureState
    usageTimeline: UsageTimelineState
  }
}

/** The context-pressure state schema and source of its inferred type. */
const contextPressureStateSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  pressureTokens: z.number().int().nonnegative().optional(),
  surfaceTokens: z.number().int().nonnegative(),
  sampledSurfaceTokens: z.number().int().nonnegative().optional(),
  claim: z.object({
    start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq),
    end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq),
    tokens: z.number().int().nonnegative(),
  }).optional(),
}).strict()

type ContextPressureState = z.infer<typeof contextPressureStateSchema>

/**
 * Token-meter's session projection unit.
 *
 * Each v2 Assistant settlement contributes the last usage sample embedded in
 * its stream. `llm/retry-started` closes the replacement slot so the retried
 * attempt adds to the total. Events below the fork boundary are skipped:
 * the inherited prefix was already billed to the source session, so this
 * session's totals fold only its own settlements.
 */
export const tokenUsageProjectionDefinition = {
  key: 'tokenUsage',
  stateVersion: 3,
  stateSchema: tokenUsageStateSchema,
  init: (_header, inheritedEventCount) => ({ forkBoundary: inheritedEventCount, totals: zeroBuckets(), last: null }),
  apply: (state, event) => {
    if (event.seq < state.forkBoundary) return state
    if (event.type === 'llm/retry-started') {
      return state.last?.turn === event.data.turn && state.last.step === event.data.step
        ? { ...state, last: null }
        : state
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') {
      return state
    }
    const sample = usageOf(event)
    if (sample === undefined) return state
    const { turn, step } = event.data
    const usage: TokenUsage = sample

    const buckets = bucketsFrom(usage)
    const previous = state.last !== null
      && state.last.turn === turn
      && state.last.step === step
      ? state.last.buckets
      : undefined
    if (previous !== undefined && bucketsEqual(previous, buckets)) return state

    return {
      forkBoundary: state.forkBoundary,
      totals: addReplacing(state.totals, previous, buckets),
      last: { turn, step, buckets },
    }
  },
  wire: { viewSchema: projectionSchema, view: state => state.totals },
} satisfies ProjectionDefinition<'tokenUsage', TokenUsageState>

/** Whole days since 1970-01-01 UTC: one event time's timeline day. */
const DAY_MS = 86_400_000

/** Most recent UTC days the wire view carries; the state keeps the full history. */
const TIMELINE_WIRE_DAY_CAP = 62

/** The usage-timeline unit's state: full per-day history plus the replacement slot. */
interface UsageTimelineState {
  /** Events below this seq are the fork-inherited prefix; their usage bills to the source session. */
  forkBoundary: number
  days: UsageTimelineDay[]
  last: {
    turn: number
    step: number
    /** UTC epoch day the slot's buckets were recorded in. */
    day: number
    buckets: TokenUsageProjection
  } | null
}

/** One timeline day's state and wire shape — the two share the day entry. */
const timelineDaySchema = z.object({
  day: z.number().int().nonnegative(),
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const usageTimelineStateSchema: z.ZodType<UsageTimelineState> = z.object({
  // Fork boundary: events below it belong to the source session's history
  // and their usage was already billed there.
  forkBoundary: z.number().int().nonnegative(),
  days: z.array(timelineDaySchema),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    day: z.number().int().nonnegative(),
    buckets: projectionSchema,
  }).nullable(),
}).strict()

const dayOf = (time: number): number => Math.floor(time / DAY_MS)

const isZeroBuckets = (buckets: TokenUsageProjection): boolean =>
  buckets.uncachedInputTokens === 0
  && buckets.outputTokens === 0
  && buckets.cacheReadTokens === 0
  && buckets.cacheWriteTokens === 0

const shiftBuckets = (
  base: TokenUsageProjection,
  delta: TokenUsageProjection,
  sign: 1 | -1,
): TokenUsageProjection => ({
  uncachedInputTokens: base.uncachedInputTokens + sign * delta.uncachedInputTokens,
  outputTokens: base.outputTokens + sign * delta.outputTokens,
  cacheReadTokens: base.cacheReadTokens + sign * delta.cacheReadTokens,
  cacheWriteTokens: base.cacheWriteTokens + sign * delta.cacheWriteTokens,
})

/** First array slot whose day is `day` or later (binary search over the ascending order). */
function daySlot(days: readonly UsageTimelineDay[], day: number): number {
  let low = 0
  let high = days.length
  while (low < high) {
    const mid = (low + high) >> 1
    // A missing slot reads as not-before-`day`, so the search still converges.
    if ((days[mid]?.day ?? day) < day) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * Add or subtract one day's buckets in the ascending day array, never
 * mutating the input. A day entry exists only while it holds usage: an
 * all-zero addition creates nothing and a subtraction that empties a day
 * removes its entry.
 */
function shiftDay(
  days: UsageTimelineDay[],
  day: number,
  delta: TokenUsageProjection,
  sign: 1 | -1,
): UsageTimelineDay[] {
  const slot = daySlot(days, day)
  const existing = days[slot]
  if (existing === undefined || existing.day !== day) {
    if (sign === 1 && !isZeroBuckets(delta)) {
      return [...days.slice(0, slot), { day, ...delta }, ...days.slice(slot)]
    }
    return days
  }
  const merged = shiftBuckets(existing, delta, sign)
  if (isZeroBuckets(merged)) {
    return [...days.slice(0, slot), ...days.slice(slot + 1)]
  }
  const next = days.slice()
  next[slot] = { day, ...merged }
  return next
}

/**
 * Token-meter's per-day usage timeline unit.
 *
 * Folds the same Assistant settlements as {@link tokenUsageProjectionDefinition}
 * into UTC-day buckets, so a daily trend chart reads the same durable records
 * without a new RPC: each sample lands in the day its event was logged in, and
 * the per-day sums stay consistent with the totals unit because the
 * replacement slot follows the identical semantics — a same turn/step
 * replacement subtracts the previous buckets from the day they were recorded
 * in (which may differ from the new sample's day) before adding the new ones,
 * and `llm/retry-started` closes the slot. Days without usage never gain
 * entries. The state keeps the full history; the wire view caps to the most
 * recent {@link TIMELINE_WIRE_DAY_CAP} days. Events below the fork boundary
 * are skipped: the inherited prefix was already billed to the source session.
 */
export const usageTimelineProjectionDefinition = {
  key: 'usageTimeline',
  stateVersion: 2,
  stateSchema: usageTimelineStateSchema,
  init: (_header, inheritedEventCount) => ({ forkBoundary: inheritedEventCount, days: [], last: null }),
  apply: (state, event) => {
    if (event.seq < state.forkBoundary) return state
    if (event.type === 'llm/retry-started') {
      return state.last !== null
        && state.last.turn === event.data.turn
        && state.last.step === event.data.step
        ? { ...state, last: null }
        : state
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') {
      return state
    }
    const sample = usageOf(event)
    if (sample === undefined) return state
    const { turn, step } = event.data
    const day = dayOf(event.time)
    const buckets = bucketsFrom(sample)
    const previous = state.last !== null
      && state.last.turn === turn
      && state.last.step === step
      ? state.last
      : null
    // A same-day restatement of the identical sample changes nothing; a
    // sample identical but for its day still moves between days.
    if (previous !== null && previous.day === day && bucketsEqual(previous.buckets, buckets)) {
      return state
    }

    let days = state.days
    if (previous !== null) days = shiftDay(days, previous.day, previous.buckets, -1)
    days = shiftDay(days, day, buckets, 1)
    return { forkBoundary: state.forkBoundary, days, last: { turn, step, day, buckets } }
  },
  wire: {
    viewSchema: z.object({ days: z.array(timelineDaySchema) }).strict(),
    view: state => ({ days: state.days.slice(-TIMELINE_WIRE_DAY_CAP) }),
  },
} satisfies ProjectionDefinition<'usageTimeline', UsageTimelineState>

/**
 * Token-meter's context-occupancy projection unit.
 *
 * Independent last-wins slots: the newest usage sample supplies the provider
 * numerator, the newest `request/context` record the denominator. Both are
 * whole values, so replay order alone decides the result and no cross-field
 * consistency is claimed — the pair is explicitly not one atomic request
 * observation (see {@link ContextPressureProjection}).
 *
 * `pressureTokens` is prompt-side only, so it holds still while a turn streams
 * and steps forward once the next request reports its usage. Because nothing
 * but a request reports usage, it also cannot see a compaction: the fold
 * therefore carries a running surface total alongside it and publishes
 * `projectedTokens` — the sample plus the surface's signed movement since it
 * was taken — so occupancy answers for the next request rather than the last
 * one. When no usage sample exists at all (a provider that reports none), the
 * running surface total itself becomes `projectedTokens`, the only occupancy
 * signal such a route leaves; the meter stays dark while the surface is
 * empty. The total rides {@link foldSurfaceProjection}, so the state stays
 * O(1) and a replacement shrinks it by its logged shadow price. A replacement
 * without a claim preserves the previous total. A usage sample is stamped
 * BEFORE the same event joins the surface, so an `assistant/message` anchors
 * against the surface its own request saw.
 */
export const contextPressureProjectionDefinition = {
  key: 'contextPressure',
  stateVersion: 6,
  stateSchema: contextPressureStateSchema,
  init: () => ({ surfaceTokens: 0 }),
  apply: (state, event) => {
    const fold = foldSurfaceProjection(state.claim, event)
    let next = state
    if (event.type === 'request/context') {
      const contextWindow = event.data.contextWindow
      if (contextWindow !== state.contextWindow) {
        if (contextWindow !== undefined) {
          next = { ...next, contextWindow }
        } else {
          const { contextWindow: _removed, ...withoutContextWindow } = next
          next = withoutContextWindow
        }
      }
    }
    const usage = usageOf(event)
    if (usage !== undefined) {
      const pressureTokens = pressureFrom(usage)
      if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) {
        next = { ...next, pressureTokens, sampledSurfaceTokens: next.surfaceTokens }
      }
    }
    if (fold.deltaTokens !== 0) {
      next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens }
    }
    // A defined fold.claim is always freshly built, so presence decides claim
    // bookkeeping: no claim before or after this event leaves `next` as is.
    if (state.claim === undefined && fold.claim === undefined) return next
    const { claim: _expired, ...withoutClaim } = next
    return fold.claim === undefined ? withoutClaim : { ...withoutClaim, claim: fold.claim }
  },
  wire: {
    viewSchema: pressureSchema,
    view: ({ contextWindow, pressureTokens, surfaceTokens, sampledSurfaceTokens }) => {
      const projectedTokens = pressureTokens === undefined
        ? surfaceTokens === 0 ? undefined : surfaceTokens
        : sampledSurfaceTokens === undefined
          ? pressureTokens
          : Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens)
      return {
        ...contextWindow === undefined ? {} : { contextWindow },
        ...pressureTokens === undefined ? {} : { pressureTokens },
        ...projectedTokens === undefined ? {} : { projectedTokens },
      }
    },
  },
} satisfies ProjectionDefinition<'contextPressure', ContextPressureState>
