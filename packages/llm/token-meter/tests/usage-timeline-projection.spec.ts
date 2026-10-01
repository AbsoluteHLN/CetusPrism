// usageTimeline projection: per-day folds of the same settlements the
// tokenUsage totals fold, with day attribution and the 62-day wire cap.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { UsageTimelineProjection } from '@deepseek-ai/dsh-token-meter/client'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import { usageTimelineProjectionDefinition } from '../src/usage-projection.ts'

const DAY_MS = 86_400_000

const today = (): number => Math.floor(Date.now() / DAY_MS)

async function harness(): Promise<{
  ctx: Context
  session: Session
  meterFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const meterFiber = await ctx.plugin(TokenMeter)
  return { ctx, session: ctx.sessions.create(), meterFiber }
}

function startStep(session: Session, turn: number, step: number): void {
  session.append('step/start', { turn, step })
}

function usageChunk(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
): void {
  session.append('assistant/attempt', {
    turn,
    step,
    stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage } }],
  })
}

function finalUsage(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
): void {
  session.append('assistant/message', {
    stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage } }],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
    usage,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step })
}

const projected = (ctx: Context, session: Session): UsageTimelineProjection => {
  const value = ctx.sessionProjections.snapshot(session).values.usageTimeline
  if (value === undefined) throw new Error('usageTimeline projection is not registered')
  return value
}

describe('usageTimeline session projection', () => {
  it('serves an empty timeline without usage samples', async () => {
    const { ctx, session } = await harness()
    expect(projected(ctx, session)).toEqual({ days: [] })
    session.append('llm/retry-started', {
      retryId: RetryId('timeline-no-usage-retry'),
      turn: 1,
      step: 1,
      retry: 1,
    })
    expect(projected(ctx, session)).toEqual({ days: [] })
  })

  it('folds the final settlement of a turn into one entry for its day', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }, 1, 1)
    finalUsage(session, {
      inputTokens: 14,
      outputTokens: 5,
      cacheReadTokens: 8,
      cacheWriteTokens: 1,
    }, 1, 1)

    expect(projected(ctx, session)).toEqual({
      days: [{ day: today(), uncachedInputTokens: 14, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 1 }],
    })
  })

  it('accumulates a retried attempt into its day once the slot is cleared', async () => {
    const { ctx, session } = await harness()
    const retryId = RetryId('timeline-retry')
    session.append('turn/start', { turn: 1 })
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }, 1, 1)
    session.append('llm/retry', {
      retryId,
      turn: 1,
      step: 1,
      provider: 'mock',
      mode: 'normal',
      policyKey: 'test',
      retry: 1,
      maxRetries: 1,
      delayMs: 0,
      failure: { code: 'RATE_LIMIT', message: 'busy', status: 429 },
    })
    session.append('llm/retry-started', { retryId, turn: 1, step: 1, retry: 1 })
    usageChunk(session, { inputTokens: 12, outputTokens: 4, cacheReadTokens: 6 }, 1, 1)
    finalUsage(session, {
      inputTokens: 14,
      outputTokens: 5,
      cacheReadTokens: 8,
      cacheWriteTokens: 1,
    }, 1, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(projected(ctx, session)).toEqual({
      days: [{ day: today(), uncachedInputTokens: 24, outputTokens: 7, cacheReadTokens: 11, cacheWriteTokens: 1 }],
    })
  })

  it('unregisters with the token-meter fiber and restores from a JSON checkpoint', async () => {
    const { ctx, session, meterFiber } = await harness()
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 8, outputTokens: 2, cacheReadTokens: 5 }, 1, 1)
    const checkpoint = JSON.parse(JSON.stringify(
      ctx.sessionProjections.checkpoint(session),
    )) as ReturnType<typeof ctx.sessionProjections.checkpoint>
    expect(checkpoint.usageTimeline?.ver).toBe(1)

    await meterFiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('usageTimeline')

    await ctx.plugin(TokenMeter)
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).usageTimeline).toEqual({
      days: [{ day: today(), uncachedInputTokens: 8, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 0 }],
    })
  })
})

/** One settlement attempt logged at an exact wall-clock time (seq in log order). */
function attemptAt(seq: number, time: number, turn: number, step: number, usage: TokenUsage): SessionEvent<'assistant/attempt'> {
  return {
    type: 'assistant/attempt',
    seq: SessionSeq(seq),
    time,
    data: {
      turn,
      step,
      stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage } }],
    },
  }
}

function retryStartedAt(seq: number, time: number, turn: number, step: number): SessionEvent<'llm/retry-started'> {
  return {
    type: 'llm/retry-started',
    seq: SessionSeq(seq),
    time,
    data: { retryId: RetryId('timeline-fold-retry'), turn, step, retry: 1 },
  }
}

const initialState = (): ReturnType<typeof usageTimelineProjectionDefinition.stateSchema.parse> =>
  usageTimelineProjectionDefinition.stateSchema.parse({ days: [], last: null })

function fold(events: readonly SessionEvent[]): UsageTimelineProjection {
  const definition = usageTimelineProjectionDefinition
  let state = initialState()
  for (const event of events) state = definition.apply(state, event)
  return definition.wire.view(state)
}

/** Noon of UTC epoch day `day`: a time that cannot straddle a day boundary. */
const noon = (day: number): number => day * DAY_MS + 12 * 3_600_000

describe('usageTimeline day folds', () => {
  it('folds settlements on two days into two ascending entries', () => {
    const first = 20_000
    const timeline = fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }),
      attemptAt(1, noon(first + 2), 1, 2, { inputTokens: 20, outputTokens: 4, cacheWriteTokens: 1 }),
    ])
    expect(timeline.days).toEqual([
      { day: first, uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 },
      { day: first + 2, uncachedInputTokens: 20, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 1 },
    ])
  })

  it('moves a same turn/step replacement out of the day it was recorded in', () => {
    const first = 20_000
    // Step 1 settles on day `first` and stays; step 2's sample is recorded on
    // day `first` but its replacement lands on day `first + 1`.
    const timeline = fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 10, outputTokens: 1 }),
      attemptAt(1, noon(first), 1, 2, { inputTokens: 10, outputTokens: 2 }),
      attemptAt(2, noon(first + 1), 1, 2, { inputTokens: 14, outputTokens: 5 }),
    ])
    expect(timeline.days).toEqual([
      { day: first, uncachedInputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { day: first + 1, uncachedInputTokens: 14, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('removes a day entry whose buckets a replacement moved away entirely', () => {
    const first = 20_000
    const moved = fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }),
      attemptAt(1, noon(first + 1), 1, 1, { inputTokens: 14, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 1 }),
    ])
    expect(moved.days).toEqual([
      { day: first + 1, uncachedInputTokens: 14, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 1 },
    ])
    // An identical sample that merely lands on a later day moves too.
    const restated = fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 10, outputTokens: 2 }),
      attemptAt(1, noon(first + 1), 1, 1, { inputTokens: 10, outputTokens: 2 }),
    ])
    expect(restated.days).toEqual([
      { day: first + 1, uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('lets a retry-started slot add a same turn/step sample instead of replacing it', () => {
    const first = 20_000
    const timeline = fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 10, outputTokens: 2 }),
      retryStartedAt(1, noon(first), 1, 1),
      attemptAt(2, noon(first), 1, 1, { inputTokens: 5, outputTokens: 3 }),
    ])
    expect(timeline.days).toEqual([
      { day: first, uncachedInputTokens: 15, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('keeps the replacement slot when a retry restarts a different turn or step', () => {
    const first = 20_000
    const definition = usageTimelineProjectionDefinition
    let state = initialState()
    const events: readonly SessionEvent[] = [
      attemptAt(0, noon(first), 1, 1, { inputTokens: 10, outputTokens: 2 }),
      // A retry of another turn does not close turn 1 step 1's slot...
      retryStartedAt(1, noon(first), 2, 1),
      attemptAt(2, noon(first), 1, 2, { inputTokens: 5, outputTokens: 3 }),
      // ...and a retry of another step does not close turn 1 step 2's slot.
      retryStartedAt(3, noon(first), 1, 1),
      attemptAt(4, noon(first), 1, 2, { inputTokens: 7, outputTokens: 1 }),
    ]
    for (const event of events) state = definition.apply(state, event)
    expect(definition.wire.view(state).days).toEqual([
      { day: first, uncachedInputTokens: 17, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('leaves the state unchanged when a settlement reports no usage sample', () => {
    const first = 20_000
    const noUsage: SessionEvent<'assistant/attempt'> = {
      type: 'assistant/attempt',
      seq: SessionSeq(0),
      time: noon(first),
      data: { turn: 1, step: 1, stream: [] },
    }
    expect(fold([noUsage]).days).toEqual([])
  })

  it('creates no entry for a zero-usage settlement', () => {
    const first = 20_000
    expect(fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 0, outputTokens: 0 }),
    ]).days).toEqual([])
    // The zero sample held the slot, so the next sample on another day adds
    // without a day to subtract from.
    expect(fold([
      attemptAt(0, noon(first), 1, 1, { inputTokens: 0, outputTokens: 0 }),
      attemptAt(1, noon(first + 1), 1, 1, { inputTokens: 9, outputTokens: 1 }),
    ]).days).toEqual([
      { day: first + 1, uncachedInputTokens: 9, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('caps the wire view at the most recent 62 days while the state keeps the full history', () => {
    const first = 20_000
    const events: SessionEvent[] = []
    for (let offset = 0; offset < 70; offset++) {
      events.push(attemptAt(offset, noon(first + offset), offset + 1, 1, { inputTokens: 10 + offset, outputTokens: 1 }))
    }
    const definition = usageTimelineProjectionDefinition
    let state = initialState()
    for (const event of events) state = definition.apply(state, event)

    expect(state.days).toHaveLength(70)
    expect(state.days.at(0)?.day).toBe(first)
    expect(state.days.at(-1)?.day).toBe(first + 69)

    const view: UsageTimelineProjection = definition.wire.view(state)
    expect(view.days).toHaveLength(62)
    expect(view.days.at(0)?.day).toBe(first + 8)
    expect(view.days).toEqual(state.days.slice(-62))
    expect(definition.wire.viewSchema.parse(view)).toEqual(view)
  })
})
