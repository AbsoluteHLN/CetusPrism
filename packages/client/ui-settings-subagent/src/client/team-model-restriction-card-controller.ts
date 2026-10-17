/** Team-specific model ceiling, kept separate from the shared Subagent allowlist. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsFormScope, SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  subagentModelCandidates, subagentModelKey,
  type AllowedSubagentModel, type SubagentModelCandidate, type SubagentModelSelectionSettings,
} from './subagent-model-selection-card-controller.ts'

/** Team-specific model restrictions stored in the profile configuration. */
export interface TeamModelRestrictionSettings {
  allowedModels: AllowedSubagentModel[]
  defaultModel?: AllowedSubagentModel
}

/** Catalog candidate annotated with the current Host authorization. */
export interface TeamModelRestrictionCandidate extends SubagentModelCandidate {
  /** This exact provider/model pair is also admitted by the shared Subagent policy. */
  hostAllowed: boolean
}

/** Observable Team settings form and catalog state. */
export interface TeamModelRestrictionState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  conflicted: boolean
  globalEnabled: boolean
  candidates: readonly TeamModelRestrictionCandidate[]
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  catalogPartial: boolean
  defaultModelKey: string
}

/** Form actions and observable state consumed by the Team settings card. */
export interface TeamModelRestrictionFace {
  hooks: { teamModelRestrictionCard: SnapshotStore<TeamModelRestrictionState> }
  toggleModel: (key: string) => void
  setDefault: (key: string) => void
  retryCatalog: () => void
  save: () => void
  discard: () => void
}

type TeamRoute = { provider: string; model: string }
type Draft = { routes: Map<string, TeamRoute>; defaultModel?: TeamRoute; revision?: number }

function copyRoutes(routes: readonly TeamRoute[]): TeamRoute[] {
  return routes.map(route => ({ ...route }))
}

function sameRoutes(left: readonly TeamRoute[], right: readonly TeamRoute[]): boolean {
  if (left.length !== right.length) return false
  const rightKeys = new Set(right.map(subagentModelKey))
  return left.every(route => rightKeys.has(subagentModelKey(route)))
}

function sameRoute(left: TeamRoute | undefined, right: TeamRoute | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.provider === right.provider && left.model === right.model
}

function defaultKey(route: TeamRoute | undefined): string {
  return route === undefined ? '' : `${encodeURIComponent(route.provider)}:${encodeURIComponent(route.model)}`
}

function fromSnapshot(snapshot: SettingsFormScopeSnapshot<TeamModelRestrictionSettings>): Draft {
  const value = snapshot.value
  return {
    routes: new Map((value?.allowedModels ?? []).map(route => [subagentModelKey(route), { ...route }])),
    ...(value?.defaultModel === undefined ? {} : { defaultModel: { ...value.defaultModel } }),
    ...(snapshot.revision === undefined ? {} : { revision: snapshot.revision }),
  }
}

/** Staged editor that keeps Team routes a subset of the separately saved Host authorization. */
export class TeamModelRestrictionCardController {
  private catalogGroups: readonly { id: string; name: string; models: { id: string; name: string }[] }[] = []
  private catalogStatus: TeamModelRestrictionState['catalogStatus'] = 'idle'
  private catalogPartial = false
  private draft: Draft | undefined
  private saving = false
  private failed = false
  private conflicted = false
  private disposed = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private readonly store: SnapshotStore<TeamModelRestrictionState>
  private readonly unsubscribeTeam: () => void
  private readonly unsubscribeGlobal: () => void

  constructor(
    private readonly teamScope: SettingsFormScope<TeamModelRestrictionSettings>,
    private readonly globalScope: SettingsFormScope<SubagentModelSelectionSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribeTeam = teamScope.subscribe(() => {
      const snapshot = teamScope.getSnapshot()
      if (this.draft !== undefined && !this.saving && snapshot.revision !== this.draft.revision) {
        const current = fromSnapshot(snapshot)
        if (sameRoutes([...current.routes.values()], [...this.draft.routes.values()])
          && sameRoute(current.defaultModel, this.draft.defaultModel)) this.clearDraft()
        else this.conflicted = true
      }
      this.publish()
    })
    this.unsubscribeGlobal = globalScope.subscribe(() => {
      if (this.hostEnabled() && this.catalogStatus === 'idle') void this.loadCatalog()
      else this.publish()
    })
    if (this.hostEnabled()) void this.loadCatalog()
  }

  /** Unsubscribe settings observers and invalidate pending completions. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.unsubscribeTeam()
    this.unsubscribeGlobal()
  }

  /**
   * Expose the settings card state and editing actions.
   * @returns The settings card's observable state and editing actions.
   */
  inject(): TeamModelRestrictionFace {
    return {
      hooks: { teamModelRestrictionCard: this.store },
      toggleModel: key => { this.toggleModel(key) },
      setDefault: key => { this.setDefault(key) },
      retryCatalog: () => { void this.loadCatalog(true) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** Reload the model catalog under the current Host authorization. */
  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalogStatus = 'idle'
    this.catalogPartial = false
    if (this.hostEnabled()) void this.loadCatalog()
    else this.publish()
  }

  /** Discard the disconnected form state and refresh the catalog. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.clearDraft()
    this.catalogGroups = []
    this.refreshCatalog()
  }

  private current(): Draft { return fromSnapshot(this.teamScope.getSnapshot()) }
  private routes(): TeamRoute[] { return [...(this.draft?.routes ?? this.current().routes).values()].map(route => ({ ...route })) }
  private defaultModel(): TeamRoute | undefined {
    const route = this.draft === undefined ? this.current().defaultModel : this.draft.defaultModel
    return route === undefined ? undefined : { ...route }
  }
  private isSelected(key: string): boolean { return this.routes().some(route => subagentModelKey(route) === key) }
  private hostEnabled(): boolean {
    const { status, value } = this.globalScope.getSnapshot()
    return status === 'ready' && value?.enabled === true && (value.allowedModels?.length ?? 0) > 0
  }
  private hostAllows(route: TeamRoute): boolean {
    const value = this.globalScope.getSnapshot().value
    return value?.enabled === true
      && (value.allowedModels ?? []).some(candidate => candidate.provider === route.provider && candidate.model === route.model)
  }
  private ensureDraft(): Draft {
    if (this.draft === undefined) this.draft = this.current()
    this.conflicted = false
    this.failed = false
    return this.draft
  }
  private toggleModel(key: string): void {
    if (this.disposed || this.saving) return
    const candidate = this.candidates().find(row => row.key === key)
    if (candidate === undefined) return
    const selected = this.isSelected(key)
    if (!selected && !candidate.hostAllowed) return
    const draft = this.ensureDraft()
    if (selected) draft.routes.delete(key)
    else draft.routes.set(key, { provider: candidate.provider, model: candidate.model })
    if (draft.defaultModel && !draft.routes.has(subagentModelKey(draft.defaultModel))) delete draft.defaultModel
    this.finishEdit()
  }
  private setDefault(key: string): void {
    if (this.disposed || this.saving) return
    const draft = this.ensureDraft()
    if (!key) delete draft.defaultModel
    else {
      const route = [...draft.routes.values()].find(candidate => defaultKey(candidate) === key)
      if (!route || !this.hostAllows(route)) return
      draft.defaultModel = { ...route }
    }
    this.finishEdit()
  }
  private finishEdit(): void {
    const current = this.current()
    if (sameRoutes([...current.routes.values()], this.routes()) && sameRoute(current.defaultModel, this.defaultModel())) this.clearDraft()
    this.publish()
  }
  private clearDraft(): void { this.draft = undefined; this.conflicted = false }
  private discard(): void {
    if (this.saving) return
    this.clearDraft()
    this.failed = false
    this.publish()
  }

  private candidates(): TeamModelRestrictionCandidate[] {
    const stored = this.current().routes
    for (const [key, route] of this.draft?.routes ?? []) stored.set(key, route)
    const selected = new Set(this.routes().map(subagentModelKey))
    const candidates: SubagentModelCandidate[] = subagentModelCandidates(this.catalogGroups, [...stored.values()], selected)
    return candidates.map(candidate => ({ ...candidate, hostAllowed: this.hostAllows(candidate) }))
  }

  private projection(): TeamModelRestrictionState {
    const snapshot = this.teamScope.getSnapshot()
    const routes = this.routes()
    const defaultModel = this.defaultModel()
    const dirty = this.draft !== undefined
      && (!sameRoutes([...this.current().routes.values()], routes)
        || !sameRoute(this.current().defaultModel, defaultModel))
    const globalReady = this.globalScope.getSnapshot().status === 'ready'
    const invalidDefault = defaultModel !== undefined
      && (!routes.some(route => route.provider === defaultModel.provider && route.model === defaultModel.model)
        || (globalReady && this.hostEnabled() && !this.hostAllows(defaultModel)))
    const invalidHostRoute = globalReady && this.hostEnabled()
      && routes.some(route => !this.hostAllows(route))
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty,
      invalid: dirty && (invalidDefault || invalidHostRoute || this.conflicted),
      saving: this.saving,
      failed: this.failed,
      conflicted: this.conflicted,
      globalEnabled: this.hostEnabled(),
      candidates: this.candidates(),
      catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial,
      defaultModelKey: defaultKey(defaultModel),
    }
  }
  private publish(): void { if (!this.disposed) this.store.set(this.projection()) }

  private async loadCatalog(force = false): Promise<void> {
    if (this.disposed || !this.hostEnabled() || (this.catalogStatus === 'loading' && !force)) return
    const generation = ++this.catalogGeneration
    this.catalogStatus = 'loading'
    this.catalogPartial = false
    this.publish()
    try {
      const response = await this.ctx.remote.session.modelCatalog()
      if (this.disposed || generation !== this.catalogGeneration) return
      if (!response.ok) throw new Error('Model catalog unavailable')
      this.catalogGroups = response.value.groups.map(group => ({
        id: group.id,
        name: group.name,
        models: group.models.map(model => ({ id: model.id, name: model.name })),
      }))
      this.catalogPartial = response.value.failures.length > 0
      this.catalogStatus = 'ready'
    } catch {
      if (this.disposed || generation !== this.catalogGeneration) return
      this.catalogGroups = []
      this.catalogStatus = 'error'
    }
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.teamScope.getSnapshot()
    const routes = this.routes()
    const defaultModel = this.defaultModel()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving
      || !this.projection().dirty || this.projection().invalid) return
    if (this.draft !== undefined && snapshot.revision !== this.draft.revision) {
      this.conflicted = true
      this.publish()
      return
    }
    const generation = this.saveGeneration
    this.saving = true
    this.failed = false
    this.conflicted = false
    this.publish()
    const accepted = await this.teamScope.mutate([
      { op: 'set', path: ['allowedModels'], value: copyRoutes(routes) },
      defaultModel === undefined
        ? { op: 'unset', path: ['defaultModel'] }
        : { op: 'set', path: ['defaultModel'], value: { ...defaultModel } },
    ], this.draft?.revision)
    if (generation !== this.saveGeneration) return
    const landed = accepted
      && sameRoutes([...this.current().routes.values()], routes)
      && sameRoute(this.current().defaultModel, defaultModel)
    this.saving = false
    this.failed = !landed
    if (landed) this.clearDraft()
    this.publish()
  }
}
