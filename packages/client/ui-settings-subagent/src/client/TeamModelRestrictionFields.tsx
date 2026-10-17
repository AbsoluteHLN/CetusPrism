/** Separate Team-only model ceiling layered over Host Subagent authorization. */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  TeamModelRestrictionCandidate, TeamModelRestrictionFace, TeamModelRestrictionState,
} from './team-model-restriction-card-controller.ts'
import css from './SubagentModelSelectionFields.module.css'

type Props = PropsLocale<'settings.subagent'>
  & Pick<TeamModelRestrictionFace, 'toggleModel' | 'setDefault' | 'retryCatalog'>
  & { state: TeamModelRestrictionState }

function selectionKey(candidate: TeamModelRestrictionCandidate): string {
  return `${encodeURIComponent(candidate.provider)}:${encodeURIComponent(candidate.model)}`
}

/** Render the additional Team allowlist and its optional fallback route. */
export function TeamModelRestrictionFields({ t, state, toggleModel, setDefault, retryCatalog }: Props) {
  const groups = new Map<string, { name: string; candidates: TeamModelRestrictionCandidate[] }>()
  const unavailable: TeamModelRestrictionCandidate[] = []
  for (const candidate of state.candidates) {
    if (!candidate.available) {
      unavailable.push(candidate)
      continue
    }
    const group = groups.get(candidate.provider)
    if (group) group.candidates.push(candidate)
    else groups.set(candidate.provider, { name: candidate.providerName, candidates: [candidate] })
  }

  const renderCandidate = (candidate: TeamModelRestrictionCandidate) => (
    <label key={candidate.key} className={css.model}>
      <input
        type="checkbox"
        checked={candidate.selected}
        disabled={!state.writable || state.saving || (!candidate.selected && !candidate.hostAllowed)}
        onChange={() => { toggleModel(candidate.key) }}
      />
      <span>
        <span className={css.modelName}>{candidate.modelName}</span>
        <span className={css.route}>{`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}</span>
      </span>
      {!candidate.hostAllowed
        ? <span className={css.unavailable}>{t('teamModelRestrictionHostDenied')}</span>
        : null}
    </label>
  )

  const selected = state.candidates.filter(candidate => candidate.selected)
  return (
    <div className={css.selection}>
      <p className={css.hint}>{t('teamModelRestrictionHelp')}</p>
      {!state.globalEnabled
        ? <p className={css.notice} role="status">{t('teamModelRestrictionHostRequired')}</p>
        : null}
      {state.catalogStatus === 'loading'
        ? <p className={css.notice} role="status">{t('subagentModelSelectionLoading')}</p>
        : null}
      {state.catalogStatus === 'error'
        ? <div className={css.catalogError} role="alert">
          <span>{t('subagentModelSelectionLoadFailed')}</span>
          <button type="button" disabled={state.saving} onClick={retryCatalog}>{t('subagentModelSelectionRetry')}</button>
        </div>
        : null}
      {state.catalogPartial ? <p className={css.notice}>{t('subagentModelSelectionPartial')}</p> : null}
      {state.candidates.length > 0
        ? <fieldset className={css.models}>
          <legend>{t('teamModelRestrictionAllowed')}</legend>
          {[...groups].map(([provider, group]) => <div key={provider} className={css.modelGroup}>
            <div className={css.providerName}>{group.name}</div>
            {group.candidates.map(renderCandidate)}
          </div>)}
          {unavailable.length > 0
            ? <div className={css.modelGroup}>
              <div className={css.providerName}>{t('subagentModelSelectionUnavailableGroup')}</div>
              {unavailable.map(renderCandidate)}
            </div>
            : null}
        </fieldset>
        : state.globalEnabled && state.catalogStatus === 'ready'
          ? <p className={css.notice}>{t('teamModelRestrictionEmpty')}</p>
          : null}
      <label className={css.defaultModel}>
        <span>{t('teamModelRestrictionDefault')}</span>
        <select
          value={state.defaultModelKey}
          disabled={!state.writable || state.saving || selected.length === 0}
          onChange={event => { setDefault(event.target.value) }}
        >
          <option value="">{t('teamModelRestrictionNoDefault')}</option>
          {selected.map(candidate => <option key={candidate.key} value={selectionKey(candidate)}>
            {candidate.provider}/{candidate.model}{candidate.hostAllowed ? '' : ` · ${t('teamModelRestrictionHostDenied')}`}
          </option>)}
        </select>
      </label>
      {state.invalid ? <p className={css.invalid} role="alert">{t('teamModelRestrictionInvalid')}</p> : null}
      {state.conflicted ? <p className={css.conflict} role="status">{t('subagentModelSelectionConflict')}</p> : null}
    </div>
  )
}
