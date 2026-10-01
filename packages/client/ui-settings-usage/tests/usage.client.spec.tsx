// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: loads this package's namespace augmentation (the `t` prop seat)
// and the projection-map members the fixtures spell out.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type {} from '../src/client/index.ts'
import { aggregateUsage } from '../src/client/aggregate.ts'
import type { UsageSessionRow } from '../src/client/aggregate.ts'
import { zh, type UsageKey } from '../src/client/locales.ts'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionProps } from '../src/client/UsageSection.tsx'

afterEach(cleanup)

/** Literal test ids are not branded `SessionId`s; the fold only reads keys. */
function byId(rows: Record<string, UsageSessionRow>): Record<SessionId, UsageSessionRow> {
  return Object.fromEntries(
    Object.entries(rows).map(([id, row]) => [SessionId(id), row]),
  )
}

function sessionRow(projectionValues: UsageSessionRow['projectionValues'], overrides: Partial<UsageSessionRow> = {}): UsageSessionRow {
  return {
    displayTitle: '会话',
    updatedAt: 1_700_000_000_000,
    ...overrides,
    ...(projectionValues === undefined ? {} : { projectionValues }),
  }
}

function usage(overrides: Partial<{
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}> = {}) {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...overrides }
}

describe('aggregateUsage', () => {
  it('sums billed input and provider buckets across sessions and folds conversation figures', () => {
    const aggregate = aggregateUsage({ byId: byId({
      a: sessionRow({
        tokenUsage: usage({ uncachedInputTokens: 100, outputTokens: 20 }),
        sessionStats: { turns: 2, steps: 3, llmMs: 1_000, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
      }),
      b: sessionRow({ tokenUsage: usage({ uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 1_000, cacheWriteTokens: 200 }) }),
    }) })
    expect(aggregate.sessionsTotal).toBe(2)
    expect(aggregate.sessionsCounted).toBe(2)
    expect(aggregate.inputTokens).toBe(1_310)
    expect(aggregate.cacheReadTokens).toBe(1_000)
    expect(aggregate.cacheWriteTokens).toBe(200)
    expect(aggregate.outputTokens).toBe(25)
    expect(aggregate.turns).toBe(2)
    expect(aggregate.llmMs).toBe(1_000)
  })

  it('ranks rows by billed total and collapses cache traffic into the input figure', () => {
    const aggregate = aggregateUsage({ byId: byId({
      small: sessionRow({ tokenUsage: usage({ uncachedInputTokens: 10 }) }),
      large: sessionRow({ tokenUsage: usage({ uncachedInputTokens: 100, cacheReadTokens: 400 }) }),
    }) })
    expect(aggregate.rows.map(row => row.inputTokens)).toEqual([500, 10])
    expect(aggregate.rows.at(0)?.cacheTokens).toBe(400)
  })

  it('counts sessions without a tokenUsage value only in coverage', () => {
    const aggregate = aggregateUsage({ byId: byId({
      counted: sessionRow({ tokenUsage: usage({ uncachedInputTokens: 5 }) }),
      cold: sessionRow(undefined),
      subagent: sessionRow({ tokenUsage: usage({ outputTokens: 7 }) }, { origin: 'subagent' }),
    }) })
    expect(aggregate.sessionsTotal).toBe(3)
    expect(aggregate.sessionsCounted).toBe(2)
    expect(aggregate.rows.find(row => row.subagent)?.outputTokens).toBe(7)
  })

  it('folds an empty corpus to zeros', () => {
    expect(aggregateUsage({ byId: {} })).toMatchObject({ sessionsTotal: 0, sessionsCounted: 0, rows: [] })
  })
})

describe('UsageSection', () => {
  const t = ((key: UsageKey, params?: Record<string, string | number>): string =>
    Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      zh[key],
    )) as UsageSectionProps['t']

  function props(rows: Record<string, UsageSessionRow>): UsageSectionProps {
    return {
      t,
      useSessions: bindSnapshotSelector(createSnapshotStore({
        ids: [], byId: byId(rows), phase: 'ready', projectionsBySession: {},
      })),
      renderSlot: () => null,
      close: () => undefined,
    } as unknown as UsageSectionProps
  }

  it('renders the summary cards and the ranked table', () => {
    render(<UsageSection {...props(byId({
      small: sessionRow({ tokenUsage: usage({ uncachedInputTokens: 40, outputTokens: 5, cacheReadTokens: 9_000 }) }, { displayTitle: '背景会话' }),
      main: sessionRow({ tokenUsage: usage({ uncachedInputTokens: 2_000, outputTokens: 300 }) }, { displayTitle: '主会话' }),
    }))} />)
    expect(screen.getAllByText('输入').length).toBe(3)
    expect(screen.getAllByText('11K').length).toBe(2)
    expect(screen.getByText('主会话')).toBeTruthy()
    expect(screen.getByText('背景会话')).toBeTruthy()
    expect(screen.getByText('2300')).toBeTruthy()
    expect(screen.getByText('305')).toBeTruthy()
    expect(screen.getByText(zh['coverage']
      .replaceAll('{counted}', '2')
      .replaceAll('{total}', '2'))).toBeTruthy()
  })

  it('marks subagent rows', () => {
    render(<UsageSection {...props(byId({
      child: sessionRow({ tokenUsage: usage({ outputTokens: 500 }) }, { displayTitle: '子代理任务', origin: 'subagent' }),
    }))} />)
    expect(screen.getByText('子代理')).toBeTruthy()
  })

  it('renders the empty state before any usage exists', () => {
    render(<UsageSection {...props(byId({ a: sessionRow(undefined) }))} />)
    expect(screen.getByText(zh['empty'])).toBeTruthy()
  })
})
