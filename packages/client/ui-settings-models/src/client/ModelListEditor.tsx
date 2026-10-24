/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel, LlmReasoningEffortProbeResult } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconPlusOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { ModelsOperations } from './operations.ts'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { en } from './locales.ts'
import { ModelRow } from './ModelRow.tsx'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Fields this card does not edit must survive an
 * edit rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Installed provider whose catalog supplies defaults without endpoint I/O. */
  catalogProvider?: string | undefined
  /** Route input types for models absent from the installed catalog. */
  defaultInput?: readonly string[] | undefined
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** The Host operations whose interrogation answers the fetch action. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
  /**
   * Called once per change with whether an endpoint interrogation is in
   * flight. The owning card folds it into its own busy state so the surface
   * around the card — a mode switch, say — can refuse to move while the
   * answer, and the picker it opens, is still bound for this list.
   */
  onBusyChange: (busy: boolean) => void
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/** Why a probed declaration cannot be written into a model entry. */
type DeclarationProblem = 'effortProbeInvalidOff' | 'effortProbeInvalidLevel'

/**
 * One row's effort-probe answer, once the endpoint answered with levels.
 */
interface ProbedEfforts {
  /** The endpoint answered with the levels one model accepts. */
  readonly kind: 'probed'
  /** The probed levels and the declaration they add up to. */
  readonly result: LlmReasoningEffortProbeResult
  /** Whether the probed declaration was written into this row. */
  readonly written: boolean
  /** Why the probed declaration was refused, when it was. */
  readonly problem?: DeclarationProblem
}

/**
 * One row's effort-probe answer.
 *
 * The probe asks about one model, so each row keeps its own answer: one
 * gateway may take a level for the model behind one route and refuse it for
 * the model behind another.
 */
type EffortProbeState =
  /** The probe is in flight. */
  | { readonly kind: 'probing' }
  /** The endpoint answered with the levels one model accepts. */
  | ProbedEfforts
  /** The probe was refused, with the Host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** One level's verdict, with the reason the endpoint gave when it refused. */
interface ProbeRow {
  /** The level the probe sent. */
  readonly level: string
  /** Whether the endpoint accepted that level. */
  readonly accepted: boolean
  /** Why the endpoint refused the level, when it refused. */
  readonly detail?: string
}

/**
 * Why the probed declaration cannot be written into a model entry, if it
 * cannot.
 *
 * The profile schema spells `off` as "no wire value" and every other level as
 * the string the endpoint expects, so a declaration breaking either rule is
 * refused here rather than stored as a shape the adapter would reject; the
 * adapter's own validation stays the backstop for everything else.
 * @param declaration - the declaration the probe answered with.
 * @returns the locale key naming the fault, or undefined when it is usable.
 */
function declarationProblem(declaration: Readonly<Record<string, string | null>>): DeclarationProblem | undefined {
  if (declaration['off'] !== null) return 'effortProbeInvalidOff'
  for (const [level, spelling] of Object.entries(declaration)) {
    if (level === 'off') continue
    if (typeof spelling !== 'string' || spelling.length === 0) return 'effortProbeInvalidLevel'
  }
  return undefined
}

/**
 * The probed levels, one row each, in probe order.
 *
 * A level the endpoint listed itself but the probe never sent still counts as
 * accepted, so the answer shows every level the endpoint claims to take.
 * @param result - the probe's answer.
 * @returns one row per level, with the refusal reason where there is one.
 */
function probeRows(result: LlmReasoningEffortProbeResult): ProbeRow[] {
  const details = new Map(result.refused.map(entry => [entry.level, entry.detail]))
  const rows: ProbeRow[] = result.outcomes.map((outcome) => {
    const detail = outcome.detail ?? details.get(outcome.level)
    return {
      level: outcome.level,
      accepted: outcome.accepted,
      ...detail === undefined ? {} : { detail },
    }
  })
  const probed = new Set(rows.map(row => row.level))
  for (const level of result.accepted) {
    if (probed.has(level)) continue
    rows.push({ level, accepted: true })
  }
  return rows
}

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Adopt a candidate, preserving disclosed capacities and input types. */
function adopt(candidate: LlmDiscoveredModel): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.inputModalities === undefined ? {} : { input: [...candidate.inputModalities] },
  }
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, operations, t, disabled, onBusyChange } = props
  const { catalogProvider } = props
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)
  useEffect(() => { onBusyChange(busy || probing) }, [busy, probing, onBusyChange])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [inheritedCatalog, setInheritedCatalog] = useState<{
    provider: string
    models: readonly LlmDiscoveredModel[]
  } | undefined>(undefined)
  useEffect(() => {
    if (catalogProvider === undefined) return
    let current = true
    void operations.discoverModels(probe.settingsNs, { provider: catalogProvider }).then((answer) => {
      if (!current) return
      setInheritedCatalog({ provider: catalogProvider, models: answer.kind === 'found' ? answer.models : [] })
      setFailure(answer.kind === 'refused' ? answer.message : undefined)
    })
    return () => { current = false }
  }, [catalogProvider, operations, probe.settingsNs])
  const catalog = inheritedCatalog?.provider === catalogProvider ? inheritedCatalog?.models : undefined
  const inputDefaults = useMemo(() => new Map(catalog?.map(model => [model.id, model.inputModalities])), [catalog])
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [candidateQuery, setCandidateQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())
  // One probe answer per row: the levels a model accepts are that model's own,
  // so two rows of the same provider keep two answers.
  const [effortProbes, setEffortProbes] = useState<ReadonlyMap<number, EffortProbeState>>(new Map())

  /** Buffer key for one capacity field; the row half moves when rows do. */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  /** Drop one row's entries and shift the rows after it down, in one pass. */
  const reindexOnRemove = (
    current: ReadonlyMap<string, string>,
    index: number,
  ): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const toggleExpanded = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const patch = (index: number, next: Record<string, string | number | undefined>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(probe.settingsNs, {
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      const found = answer.models
      if (catalogProvider !== undefined) setInheritedCatalog({ provider: catalogProvider, models: found })
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidateQuery('')
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Ask the endpoint which reasoning-effort levels one row's model accepts.
   *
   * The question is about that model alone, so the request names it and
   * travels the endpoint facts as the form currently shows them — exactly as
   * the model fetch asks. Nothing is written: the answer is metadata the
   * user may adopt, not configuration changed behind them.
   */
  const probeEfforts = async (index: number, model: ModelDraft): Promise<void> => {
    setProbing(true)
    setEffortProbes(current => new Map(current).set(index, { kind: 'probing' }))
    try {
      const answer = await operations.probeReasoningEfforts(probe.settingsNs, {
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        model: textOf(model, 'id'),
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      setEffortProbes(current => new Map(current).set(index, answer.kind === 'probed'
        ? { kind: 'probed', result: answer.result, written: false }
        : { kind: 'refused', message: answer.message }))
    } catch (error: unknown) {
      // A probe the page cannot run at all is a refusal the user can read,
      // not a broken surface: the seam answers with a refusal, and a throw
      // only means the call itself could not be made.
      setEffortProbes(current => new Map(current).set(index, {
        kind: 'refused',
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setProbing(false)
    }
  }

  /**
   * Write the probed declaration into the probed row, and into that row only.
   *
   * The levels a model accepts are that model's own, so the write touches one
   * model entry: the other models under the same provider keep the levels
   * they were configured with.
   * @param index - the probed row.
   * @param state - the probe's answer for that row.
   */
  const writeDeclaration = (index: number, state: ProbedEfforts): void => {
    const problem = declarationProblem(state.result.declaration)
    if (problem !== undefined) {
      setEffortProbes(current => new Map(current).set(index, {
        kind: 'probed', result: state.result, written: false, problem,
      }))
      return
    }
    const declaration = { ...state.result.declaration }
    onChange(models.map((row, at) => at === index ? { ...row, reasoningEfforts: declaration } : row))
    setEffortProbes(current => new Map(current).set(index, {
      kind: 'probed', result: state.result, written: true,
    }))
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
    setCandidateQuery('')
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const activeCandidates = candidates ?? []
  const normalizedCandidateQuery = candidateQuery.trim().toLowerCase()
  const visibleCandidates = normalizedCandidateQuery.length === 0
    ? activeCandidates
    : activeCandidates.filter(candidate => candidate.id.toLowerCase().includes(normalizedCandidateQuery)
      || candidate.name?.toLowerCase().includes(normalizedCandidateQuery) === true)
  const allVisibleCandidatesPicked = visibleCandidates.length > 0
    && visibleCandidates.every(candidate => picked.has(candidate.id))

  const toggleVisibleCandidates = (): void => {
    setPicked((current) => {
      if (visibleCandidates.every(candidate => current.has(candidate.id))) {
        return new Set()
      }
      const next = new Set(current)
      for (const candidate of visibleCandidates) next.add(candidate.id)
      return next
    })
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  /**
   * One row's effort-probe surface: the action, the levels the endpoint
   * answered with, and the write-back that adopts them.
   * @param index - the row the probe answers about.
   * @param model - that row's draft.
   * @returns the row's probe surface.
   */
  const effortProbePanel = (index: number, model: ModelDraft): ReactNode => {
    const state = effortProbes.get(index)
    const modelId = textOf(model, 'id')
    const probing = state?.kind === 'probing'
    const blocked = props.probeBlocked
    const rows = state?.kind === 'probed' ? probeRows(state.result) : []
    return (
      <div className={styles['modelField']}>
        <span className={styles['modelFieldLabel']}>{t('effortProbe')}</span>
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || probing || modelId.length === 0 || !askable || blocked !== undefined}
          title={blocked !== undefined
            ? t(blocked)
            : modelId.length === 0
              ? t('effortProbeNeedsModel')
              : askable ? undefined : t('effortProbeNeedsBaseUrl')}
          onClick={() => { void probeEfforts(index, model) }}
        >
          {probing ? t('effortProbing') : t('effortProbe')}
        </button>
        {state?.kind === 'refused' ? <p className={styles['error']}>{state.message}</p> : null}
        {rows.length === 0
          ? null
          : (
            <ul className={styles['modelInputChoices']}>
              {rows.map(row => (
                <li key={row.level}>
                  <span className={styles['candidateId']}>{row.level}</span>
                  <span>{row.accepted ? t('effortProbeAccepted') : t('effortProbeRefused')}</span>
                  {row.detail === undefined ? null : <span>{row.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        {state?.kind === 'probed' && state.result.declared !== undefined
          ? <p className={styles['advancedHint']}>{`${t('effortProbeDeclared')} ${state.result.declared.join(', ')}`}</p>
          : null}
        {state?.kind === 'probed'
          ? (
            <>
              <button
                type="button"
                className={styles['linkButton']}
                disabled={disabled}
                onClick={() => { writeDeclaration(index, state) }}
              >
                {t('effortProbeWrite')}
              </button>
              {state.problem === undefined ? null : <p className={styles['error']}>{t(state.problem)}</p>}
              {state.written ? <p className={styles['advancedHint']}>{t('effortProbeWritten')}</p> : null}
            </>
          )
          : null}
      </div>
    )
  }
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      <div className={styles['modelList']}>
        {models.map((model, index) => (
          <ModelRow
            key={index}
            model={model}
            position={index + 1}
            inputField="input"
            inputFallback={inputDefaults.get(textOf(model, 'id')) ?? props.defaultInput}
            inputLoading={catalogProvider !== undefined && catalog === undefined}
            reasoningEfforts
            effortProbe={effortProbePanel(index, model)}
            expanded={expanded.has(index)}
            disabled={disabled}
            t={t}
            contextWindow={{
              value: capacityText(model, index, 'contextWindow'),
              placeholder: CAPACITY_HINT.contextWindow,
              onChange: (text) => { editCapacity(index, 'contextWindow', text) },
            }}
            maxTokens={{
              value: capacityText(model, index, 'maxTokens'),
              placeholder: CAPACITY_HINT.maxTokens,
              onChange: (text) => { editCapacity(index, 'maxTokens', text) },
            }}
            onFieldChange={(field, value) => { patch(index, { [field]: value }) }}
            onChange={(next) => { onChange(models.map((row, at) => at === index ? next : row)) }}
            onToggle={() => { toggleExpanded(index) }}
            onRemove={() => {
              onChange(models.filter((_model, at) => at !== index))
              setExpanded((current) => {
                const next = new Set<number>()
                for (const at of current) {
                  if (at < index) next.add(at)
                  else if (at > index) next.add(at - 1)
                }
                return next
              })
              setEditing(current => reindexOnRemove(current, index))
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        <IconPlusOutlineRegular size={14} />
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <div className={styles['candidateToolbar']}>
          <input
            className={`${styles['input']} ${styles['candidateSearch']}`}
            type="search"
            value={candidateQuery}
            placeholder={t('fetchSearch')}
            aria-label={t('fetchSearch')}
            onChange={(event) => { setCandidateQuery(event.target.value) }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={visibleCandidates.length === 0}
            onClick={toggleVisibleCandidates}
          >
            {t(allVisibleCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        {visibleCandidates.length === 0
          ? <p className={styles['candidateEmpty']} role="status">{t('fetchNoMatches')}</p>
          : (
            <ul className={styles['candidateList']}>
              {visibleCandidates.map(candidate => (
                <li key={candidate.id} className={styles['candidate']}>
                  <label className={styles['candidateLabel']}>
                    <input
                      type="checkbox"
                      checked={picked.has(candidate.id)}
                      onChange={() => { toggle(candidate.id) }}
                    />
                    <span className={styles['candidateId']} title={candidate.name ?? candidate.id}>
                      {candidate.id}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
      </Modal>
    </section>
  )
}
