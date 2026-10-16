/** Shared presentation and actions for the two Host-owned Subagent settings sections. */

import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SubagentLimitsCardFace, SubagentLimitsCardState } from './subagent-limits-card-controller.ts'
import type {
  SubagentModelSelectionCardFace, SubagentModelSelectionCardState,
} from './subagent-model-selection-card-controller.ts'
import type { TeamModelRestrictionFace, TeamModelRestrictionState } from './team-model-restriction-card-controller.ts'

const EMPTY_TEAM_MODEL_STATE: TeamModelRestrictionState = {
  available: false,
  writable: false,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
  conflicted: false,
  globalEnabled: false,
  candidates: [],
  catalogStatus: 'idle',
  catalogPartial: false,
  defaultModelKey: '',
}

const EMPTY_TEAM_MODEL_FACE: TeamModelRestrictionFace = {
  hooks: { teamModelRestrictionCard: createSnapshotStore(EMPTY_TEAM_MODEL_STATE) },
  toggleModel: () => {},
  setDefault: () => {},
  retryCatalog: () => {},
  save: () => {},
  discard: () => {},
}

/** The Host-owned Subagent, Team, and delegation-limit forms composed into one card. */
export interface SubagentCardFace {
  hooks: SubagentLimitsCardFace['hooks'] & SubagentModelSelectionCardFace['hooks'] & TeamModelRestrictionFace['hooks']
  editLimit: SubagentLimitsCardFace['edit']
  resetLimit: SubagentLimitsCardFace['resetField']
  toggleEnabled: SubagentModelSelectionCardFace['toggleEnabled']
  toggleModel: SubagentModelSelectionCardFace['toggleModel']
  retryCatalog: SubagentModelSelectionCardFace['retryCatalog']
  toggleTeamModel: TeamModelRestrictionFace['toggleModel']
  setTeamDefault: TeamModelRestrictionFace['setDefault']
  retryTeamCatalog: TeamModelRestrictionFace['retryCatalog']
  /** Save valid drafts through their owning namespace controllers. */
  save: () => void
  /** Discard both drafts without changing persisted settings. */
  discard: () => void
}

/**
 * Derive the shared card state without duplicating either form's subscriptions.
 * @param limits - Current delegation-limit form.
 * @param models - Current model-authorization form.
 * @returns Availability and settlement across the sections this Host serves.
 */
export function subagentCardShell(
  limits: SubagentLimitsCardState,
  models: SubagentModelSelectionCardState,
  teamModels: TeamModelRestrictionState = EMPTY_TEAM_MODEL_STATE,
): SettingsFormShell {
  const sections = [limits, models, teamModels].filter(section => section.available)
  return {
    available: sections.length > 0,
    writable: sections.every(section => section.writable),
    dirty: sections.some(section => section.dirty),
    invalid: sections.some(section => section.invalid)
      || (models.available && models.dirty && models.conflicted)
      || (teamModels.available && teamModels.dirty && teamModels.invalid),
    saving: sections.some(section => section.saving),
    failed: sections.some(section => section.failed),
  }
}

/**
 * Compose one card from the existing forms; each write retains its namespace revision fence.
 * @param limits - Limit form source and actions.
 * @param models - Model form source and actions.
 * @returns Framework-bound sources and shared save/discard actions.
 */
export function subagentCardFace(
  limits: SubagentLimitsCardFace,
  models: SubagentModelSelectionCardFace,
  teamModels: TeamModelRestrictionFace = EMPTY_TEAM_MODEL_FACE,
): SubagentCardFace {
  return {
    hooks: { ...limits.hooks, ...models.hooks, ...teamModels.hooks },
    editLimit: limits.edit,
    resetLimit: limits.resetField,
    toggleEnabled: models.toggleEnabled,
    toggleModel: models.toggleModel,
    retryCatalog: models.retryCatalog,
    toggleTeamModel: teamModels.toggleModel,
    setTeamDefault: teamModels.setDefault,
    retryTeamCatalog: teamModels.retryCatalog,
    save: () => {
      const limitState = limits.hooks.subagentLimitsCard.getSnapshot()
      const modelState = models.hooks.subagentModelSelectionCard.getSnapshot()
      const teamState = teamModels.hooks.teamModelRestrictionCard.getSnapshot()
      const state = subagentCardShell(limitState, modelState, teamState)
      if (!state.available || !state.writable || !state.dirty || state.invalid || state.saving) return
      if (modelState.available && modelState.dirty) models.save()
      if (teamState.available && teamState.dirty) teamModels.save()
      if (limitState.available && limitState.dirty) limits.save()
    },
    discard: () => {
      if (subagentCardShell(
        limits.hooks.subagentLimitsCard.getSnapshot(),
        models.hooks.subagentModelSelectionCard.getSnapshot(),
        teamModels.hooks.teamModelRestrictionCard.getSnapshot(),
      ).saving) return
      limits.discard()
      models.discard()
      teamModels.discard()
    },
  }
}
