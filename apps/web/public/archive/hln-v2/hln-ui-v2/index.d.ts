// ProjectHLN UI System v2 - TypeScript Declarations

export type HlnV2Theme =
  | "arknights"
  | "endfield"
  | "rhodes-island"
  | "monster-siren"
  | "rhine-lab"
  | "blacksteel"
  | "babel"
  | "victoria-steam"
  | "abyss-aegir"

export type HlnV2Font =
  | "display"
  | "body"
  | "classic"
    | "technical"

export type HlnV2MotionPreset = "panel" | "item" | "control"
export type HlnV2MotionState = "enter" | "exit"
export type HlnV2MotionVariant = "spring" | "cyber-scan" | "blur-zoom" | "wipe-reveal" | "quantum-glitch" | "radar-sweep" | "prism-burst"

export interface HlnV2ThemeMetadata {
  id: HlnV2Theme
  label: string
  swatch: string
  accent: string
  colorScheme: "dark" | "light"
}

export interface HlnV2BgPreset {
  id: string
  label: string
  note: string
}

export declare const HLN_V2_THEMES: readonly HlnV2Theme[]
export declare const HLN_V2_THEME_REGISTRY: readonly HlnV2ThemeMetadata[]
export declare const HLN_V2_BG_PRESETS: readonly HlnV2BgPreset[]
export declare const HLN_V2_FONTS: readonly HlnV2Font[]

export declare function isHlnV2Theme(theme: string): theme is HlnV2Theme
export declare function applyHlnV2Theme(theme: HlnV2Theme, target?: HTMLElement | null): boolean
export declare function currentHlnV2Theme(target?: HTMLElement | null): HlnV2Theme

export declare function isHlnV2Font(font: string): font is HlnV2Font
export declare function applyHlnV2Font(font: HlnV2Font, target?: HTMLElement | null): boolean
export declare function currentHlnV2Font(target?: HTMLElement | null): HlnV2Font

export declare function playHlnV2Motion(
  scope: HTMLElement | null,
  preset?: HlnV2MotionPreset,
  state?: HlnV2MotionState,
  variant?: HlnV2MotionVariant
): void

export * from "./runtime-transport.js"
