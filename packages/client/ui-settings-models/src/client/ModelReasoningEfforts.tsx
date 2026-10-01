/** Per-model reasoning-effort declaration for the pi-ai catalog editor. */

import type { ReactNode } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Declared reasoning levels in escalation order; `off` maps to no wire value. */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type Level = (typeof LEVELS)[number]

/** Locale keys for the level labels, in the same order as {@link LEVELS}. */
const LEVEL_KEYS: Record<Level, ModelsKey> = {
  off: 'modelReasoningOff',
  minimal: 'modelReasoningMinimal',
  low: 'modelReasoningLow',
  medium: 'modelReasoningMedium',
  high: 'modelReasoningHigh',
  xhigh: 'modelReasoningXhigh',
  max: 'modelReasoningMax',
}

/** Which declaration the row's select shows for the stored value. */
type Mode = 'inherit' | 'none' | 'custom'

function modeOf(value: unknown): Mode {
  if (value === false) return 'none'
  if (value !== undefined && value !== null && typeof value === 'object') return 'custom'
  return 'inherit'
}

/** The thinking levels (everything but `off`) currently checked. */
function checkedThinkingLevels(value: unknown): Level[] {
  if (typeof value !== 'object' || value === null) return []
  return LEVELS.filter(level => level !== 'off' && level in value)
}

/** Props of {@link ModelReasoningEfforts}. */
interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  model: DeepSeekModelDraft
  /** One-based row position for the accessible group label. */
  position: number
  /** Prevent changes while read-only or saving. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace this row, preserving unrelated configuration. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Declare one hand-added model's reasoning efforts, mirroring the profile
 * schema's `reasoningEfforts` field: absent keeps a hand-declared model
 * without an effort picker, `false` marks a non-reasoning model, and a
 * non-empty dict offers the checked levels — `off` sending no wire value,
 * every other level sending its own id as the wire spelling. Unchecking the
 * last thinking level is disabled, so the stored dict always offers at least
 * one; the adapter validation remains the loud backstop for hand-edited
 * profiles.
 * @param props - model declaration and row replacement action.
 * @returns the labeled declaration select and level checkboxes.
 */
export function ModelReasoningEfforts({ model, position, disabled, t, onChange }: ModelReasoningEffortsProps): ReactNode {
  const stored = model['reasoningEfforts']
  const mode = modeOf(stored)
  const checked = new Set(mode === 'custom' ? checkedThinkingLevels(stored) : [])
  const hasOff = mode === 'custom' && typeof stored === 'object' && stored !== null && 'off' in stored

  return (
    <fieldset className={styles['modelInputTypes']}>
      <legend className={styles['modelFieldLabel']}>{t('modelReasoning')}</legend>
      <select
        className={`${styles['input']} ${styles['selectInput']}`}
        value={mode}
        aria-label={`${t('modelReasoning')} ${String(position)}`}
        disabled={disabled}
        onChange={(event) => {
          const choice = event.target.value as Mode
          if (choice === 'inherit') {
            const next = { ...model }
            Reflect.deleteProperty(next, 'reasoningEfforts')
            onChange(next)
            return
          }
          // A fresh declaration offers the common low/medium/high ladder plus
          // an explicit off; the checkboxes adjust it from there.
          onChange({
            ...model,
            ...(choice === 'none'
              ? { reasoningEfforts: false }
              : { reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } }),
          })
        }}
      >
        <option value="inherit">{t('modelReasoningInherit')}</option>
        <option value="none">{t('modelReasoningNone')}</option>
        <option value="custom">{t('modelReasoningCustom')}</option>
      </select>
      {mode === 'custom'
        ? (
          <div className={styles['modelInputChoices']}>
            {LEVELS.map(level => (
              <Checkbox
                key={level}
                label={t(LEVEL_KEYS[level])}
                checked={level === 'off' ? hasOff : checked.has(level)}
                disabled={disabled
                  || (level !== 'off' && checked.has(level) && checked.size === 1)}
                onChange={(next) => {
                  const levels = new Set(checked)
                  if (next) levels.add(level)
                  else levels.delete(level)
                  const dict: Record<string, string | null> = {}
                  if (level === 'off' ? next : hasOff) dict['off'] = null
                  for (const item of LEVELS) {
                    if (item !== 'off' && levels.has(item)) dict[item] = item
                  }
                  onChange({ ...model, reasoningEfforts: dict })
                }}
              />
            ))}
          </div>
        )
        : null}
    </fieldset>
  )
}
