/**
 * The usage section's daily trend chart: two smoothed series (billed input
 * and output) over the most recent 7 or 30 UTC days, folded from the
 * aggregate's `usageTimeline` days. Hand-rolled SVG — no chart dependency —
 * with HTML axis labels around a stretched viewBox (`preserveAspectRatio`
 * "none" would distort text inside the SVG, so labels stay outside it).
 * Series, gridline, and label colors come from the theme's design tokens.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { UsageTimelineDay } from '@deepseek-ai/dsh-token-meter/client'
import { formatTokens, type UsageTranslate } from './format.ts'
import css from './UsageChart.module.css'

export interface UsageChartProps {
  /** Days with usage, ascending by day; gaps inside the range read as zero. */
  timeline: readonly UsageTimelineDay[]
  /** The section's translate face. */
  t: UsageTranslate
}

type RangeOption = '7' | '30'

/** Each toggle option's day span and its locale key. */
const RANGES: Record<RangeOption, { days: number; labelKey: 'chart.range7' | 'chart.range30' }> = {
  '7': { days: 7, labelKey: 'chart.range7' },
  '30': { days: 30, labelKey: 'chart.range30' },
}

const RANGE_OPTIONS: readonly RangeOption[] = ['7', '30']

const DAY_MS = 86_400_000

/** SVG plot geometry: a stretched 600x180 viewBox with hairline-inset gridlines. */
const VIEW_WIDTH = 600
const VIEW_HEIGHT = 180
const PLOT_TOP = 2
const PLOT_BOTTOM = VIEW_HEIGHT - PLOT_TOP

interface Point {
  x: number
  y: number
}

/**
 * One series' Catmull-Rom spline as a cubic-bezier path. Control points are
 * clamped to the plot so a zero day between busy days cannot overshoot past
 * the gridlines.
 */
function smoothPath(points: readonly Point[]): string {
  const [first] = points
  if (points.length < 2 || first === undefined) return ''
  const at = (index: number): Point => {
    const point = points[Math.max(0, Math.min(points.length - 1, index))]
    return point ?? first
  }
  const round = (value: number): number => Math.round(value * 100) / 100
  const clampY = (value: number): number => Math.max(PLOT_TOP, Math.min(PLOT_BOTTOM, value))
  let d = `M ${round(first.x)} ${round(first.y)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    d += ` C ${round(p1.x + (p2.x - p0.x) / 6)} ${round(clampY(p1.y + (p2.y - p0.y) / 6))},`
      + ` ${round(p2.x - (p3.x - p1.x) / 6)} ${round(clampY(p2.y - (p3.y - p1.y) / 6))},`
      + ` ${round(p2.x)} ${round(p2.y)}`
  }
  return d
}

/**
 * Smallest exact gridline ceiling of the form {1, 2, 4, 10} x 10^k that covers
 * the peak; 5 x 10^k is excluded so the half gridline's label stays an exact
 * figure under `formatTokens` at every magnitude.
 */
function gridCeiling(peak: number): number {
  // A range without usage still feeds the (unrendered) path math; any
  // positive ceiling reads the same as the empty note that replaces it.
  if (peak <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(peak))
  for (const step of [1, 2, 4, 10]) {
    const ceiling = step * power
    if (ceiling >= peak) return ceiling
  }
  return 10 * power
}

/** M/D label of a UTC epoch day. */
function dayLabel(day: number): string {
  const date = new Date(day * DAY_MS)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

/**
 * Render the daily token trend chart.
 * @param props - the aggregate timeline plus the section translate face.
 * @returns the chart element tree.
 */
export function UsageChart({ timeline, t }: UsageChartProps) {
  const [range, setRange] = useState<RangeOption>('7')
  const plotRef = useRef<SVGSVGElement>(null)
  const chart = useMemo(() => {
    const { days } = RANGES[range]
    const today = Math.floor(Date.now() / DAY_MS)
    const byDay = new Map(timeline.map((day): [number, UsageTimelineDay] => [day.day, day]))
    const input: number[] = []
    const output: number[] = []
    let peak = 0
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = today - offset
      const entry = byDay.get(day)
      const inputTokens = entry === undefined
        ? 0
        : entry.uncachedInputTokens + entry.cacheReadTokens + entry.cacheWriteTokens
      const outputTokens = entry?.outputTokens ?? 0
      input.push(inputTokens)
      output.push(outputTokens)
      peak = Math.max(peak, inputTokens, outputTokens)
    }
    const labelSlots = [...new Set([0, 1, 2, 3].map(slot => Math.round(slot * (days - 1) / 3)))]
    const yMax = gridCeiling(peak)
    const toPoint = (value: number, index: number): Point => ({
      x: index * VIEW_WIDTH / (days - 1),
      y: PLOT_BOTTOM - (value / yMax) * (PLOT_BOTTOM - PLOT_TOP),
    })
    return {
      days,
      firstDay: today - days + 1,
      labelSlots,
      hasUsage: peak > 0,
      yMax,
      inputPath: smoothPath(input.map(toPoint)),
      outputPath: smoothPath(output.map(toPoint)),
      inputTotal: input.reduce((total, value) => total + value, 0),
      outputTotal: output.reduce((total, value) => total + value, 0),
    }
  }, [timeline, range])

  // Every range re-render redraws the series with the shell's rail-draw
  // enter variant; without the shim this is inert.
  useEffect(() => {
    const plot = plotRef.current
    const hln = typeof window === 'undefined' ? undefined : window.HLN
    if (plot === null || hln === undefined) return
    hln.playMotion(plot, 'panel', 'enter', 'rail-draw')
  }, [chart, range])

  return (
    <div className={css.chart}>
      <div className={css.header}>
        <span className={css.title}>{t('chart.title')}</span>
        <div className={css.rangeToggle} role="group" aria-label={t('chart.title')}>
          {RANGE_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              className={option === range ? css.rangeButtonActive : css.rangeButton}
              aria-pressed={option === range}
              onClick={() => { setRange(option) }}
            >
              {t(RANGES[option].labelKey)}
            </button>
          ))}
        </div>
      </div>
      {chart.hasUsage ? (
        <>
          <div className={css.body}>
            <div className={css.yAxis} aria-hidden="true">
              <span>{formatTokens(chart.yMax, t)}</span>
              <span>{formatTokens(chart.yMax / 2, t)}</span>
              <span>0</span>
            </div>
            <svg
              ref={plotRef}
              className={css.plotSvg}
              data-hln-motion="panel"
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={t('chart.aria', {
                range: chart.days,
                input: formatTokens(chart.inputTotal, t),
                output: formatTokens(chart.outputTotal, t),
              })}
            >
              <line className={css.grid} x1={0} x2={VIEW_WIDTH} y1={PLOT_TOP} y2={PLOT_TOP} vectorEffect="non-scaling-stroke" />
              <line className={css.grid} x1={0} x2={VIEW_WIDTH} y1={VIEW_HEIGHT / 2} y2={VIEW_HEIGHT / 2} vectorEffect="non-scaling-stroke" />
              <line className={css.grid} x1={0} x2={VIEW_WIDTH} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} vectorEffect="non-scaling-stroke" />
              <path className={css.seriesInput} d={chart.inputPath} vectorEffect="non-scaling-stroke" />
              <path className={css.seriesOutput} d={chart.outputPath} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className={css.xAxis} aria-hidden="true">
            {chart.labelSlots.map(slot => <span key={slot}>{dayLabel(chart.firstDay + slot)}</span>)}
          </div>
        </>
      ) : (
        <div className={css.emptyNote}>{t('chart.empty')}</div>
      )}
      <div className={css.legend}>
        <span className={css.legendItem}>
          <span className={`${css.legendDot} ${css.legendDotInput}`} aria-hidden="true" />
          {t('chart.legend.input')}
        </span>
        <span className={css.legendItem}>
          <span className={`${css.legendDot} ${css.legendDotOutput}`} aria-hidden="true" />
          {t('chart.legend.output')}
        </span>
      </div>
    </div>
  )
}
