export declare const HLN_V32_VERSION: "3.2.0"
export declare const HLN_V32_MATH_CONSTANTS: Readonly<{
  PHI: number
  INV_PHI: number
  SQRT2: number
}>
export type HlnV32ThemeId =
  | "linear-obsidian"
  | "linear-platinum"
  | "linear-amber"
  | "linear-paper"
  | "linear-emerald"
  | "linear-mono"
export declare const HLN_V32_THEMES: readonly HlnV32ThemeId[]
export interface HlnV32ThemeMeta {
  id: HlnV32ThemeId
  label: string
  accent: string
  swatch: string
  colorScheme: "dark" | "light"
  description: string
}
export declare const HLN_V32_THEME_REGISTRY: readonly HlnV32ThemeMeta[]
export type HlnV32FontId = "geometric" | "grotesque" | "editorial" | "technical" | "display"
export type HlnV32CjkFontId = "auto" | "hei" | "display" | "song" | "kai" | "mono" | "fangsong"
export declare const HLN_V32_FONTS: readonly HlnV32FontId[]
export declare const HLN_V32_CJK_FONTS: readonly HlnV32CjkFontId[]
export declare const HLN_V32_BG_PRESETS: ReadonlyArray<{ id: string; label: string; note: string }>
export declare const HLN_V32_MOTION_VARIANTS: readonly string[]
export declare function applyHlnV32Theme(root: HTMLElement, themeId?: HlnV32ThemeId): HlnV32ThemeId
export declare function applyHlnV32CjkFont(root: HTMLElement, cjkFontId?: HlnV32CjkFontId): HlnV32CjkFontId
