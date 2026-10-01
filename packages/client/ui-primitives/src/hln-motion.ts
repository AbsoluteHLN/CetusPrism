/**
 * Client hook over the web shell's HLN v3.5 motion system.
 *
 * The shell publishes `window.HLN.playMotion` before any plugin loads; the
 * shim owns the reduced-motion check and the animationend cleanup, so a
 * consumer only tags its elements with `data-hln-motion` and plays once on
 * mount. Without the shim (a plugin tree hosted outside the CetusPrism web
 * shell) every helper here is a no-op.
 *
 * @module hln-motion
 */
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Shape of the web shell's HLN shim (apps/web/public/hln-ui-v3.5/hln-v35-fix.js):
 * the official v3.5 catalog accessors over the `data-hln-*` attributes.
 * Consumers degrade to no-ops when the shim is absent (a plugin tree hosted
 * outside the CetusPrism web shell).
 */
export interface HlnUiApi {
  /** Official theme ids. */
  themes: readonly string[]
  /** Official font-mode ids. */
  fonts: readonly string[]
  /** Official CJK font-mode ids. */
  cjkFonts: readonly string[]
  /** Official background-preset ids. */
  bgMotions: readonly string[]
  currentTheme(): string
  currentFont(): string
  currentCjkFont(): string
  currentBgMotion(): string
  applyTheme(id: string): boolean
  applyFont(id: string): boolean
  applyCjkFont(id: string): boolean
  applyBgMotion(id: string): boolean
  isTheme(id: unknown): boolean
  isFont(id: unknown): boolean
  isCjkFont(id: unknown): boolean
  isBgMotion(id: unknown): boolean
  /**
   * Play the curated enter motion over `scope`: every `data-hln-motion`
   * descendant (or the scope itself when it carries one) animates once with
   * its DOM order as the stagger index. The shim owns the reduced-motion
   * check and the animationend cleanup.
   */
  playMotion(scope: Element, preset?: string, state?: string, variant?: string): void
}

declare global {
  interface Window {
    /** The HLN v3.2 shim published by the web shell before any plugin loads. */
    HLN?: HlnUiApi
  }
}

/** The dist's curated enter presets (the `data-hln-motion` attribute values). */
export type HlnMotionPreset = 'panel' | 'item' | 'control'

/**
 * The dist's enter variants that override a preset's base animation. The
 * preset base rules (panel/item/control) are also accepted here because the
 * attribute takes either.
 */
export type HlnMotionVariant =
  | 'panel' | 'item' | 'control'
  | 'stream-cascade' | 'tensor-fold' | 'compile-lock' | 'wave-propagate'
  | 'vector-construct' | 'golden-iris' | 'rail-draw' | 'type-in' | 'page-shift'

/**
 * Play the shell's HLN enter motion over the referenced scope once on mount.
 * The scope itself needs no attribute — every `data-hln-motion` descendant
 * (or the scope itself when it carries one) animates with its DOM order as
 * the stagger index.
 * @param preset - the `data-hln-motion` value the scope's elements carry.
 * @param variant - optional enter variant overriding the preset's base animation.
 * @returns the scope ref to attach to the motion host element.
 */
export function useHlnEnterMotion(
  preset: HlnMotionPreset,
  variant?: HlnMotionVariant,
): RefObject<HTMLDivElement> {
  const scope = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scope.current
    const hln = typeof window === 'undefined' ? undefined : window.HLN
    if (element === null || hln === undefined) return
    hln.playMotion(element, preset, 'enter', variant)
  }, [preset, variant])
  return scope
}
