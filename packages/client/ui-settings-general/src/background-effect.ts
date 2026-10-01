/**
 * Placeholder — original implementation lost to the 2026-09 disk corruption.
 * This module is not imported by any surviving source file; it exists only so
 * the package typechecks. Re-implement the background effect here when needed.
 */
export type BackgroundEffectKind = 'off' | 'aurora' | 'particles'

/**
 * One background-effect setting as persisted in general settings.
 * @param kind - which effect renders behind the workspace.
 * @param enabled - whether the effect renders at all.
 */
export interface BackgroundEffectOptions {
  kind: BackgroundEffectKind
  enabled: boolean
}

/** The restored default: no background effect. */
export const DEFAULT_BACKGROUND_EFFECT: BackgroundEffectOptions = {
  kind: 'off',
  enabled: false,
}
