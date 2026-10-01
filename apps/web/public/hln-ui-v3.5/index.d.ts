// ProjectHLN UI System v3.5 - TypeScript Declarations (index.d.ts)

export type HlnV35ThemeId =
  | "singularity-cyan"
  | "tensor-amber"
  | "veridian-stream"
  | "synapse-violet"
  | "cobalt-manifold"
  | "titanium-oxide"
  | "alabaster-studio"
  | "bauhaus-compiler"

export type HlnV35FontId =
  | "geometric"
  | "display"
  | "technical"
  | "grotesque"
  | "cyber"
  | "berlin"
  | "editorial"
  | "label"

export type HlnV35CjkFontId =
  | "auto"
  | "hei"
  | "display"
  | "song"
  | "kai"
  | "mono"
  | "fangsong"

export type HlnV35BgPresetId =
  | "tensor-stream"
  | "neural-dag"
  | "fourier-harmonics"
  | "procedural-matrix"
  | "simplex-contour"
  | "clock-bus"
  | "swiss-vector"
  | "quiet"

export interface HlnV35ThemeMetadata {
  readonly id: HlnV35ThemeId
  readonly label: string
  readonly colorScheme: "dark" | "light"
  readonly swatch: string
  readonly accent: string
  readonly category: string
}

export declare const HLN_V35_MATH_CONSTANTS: Readonly<{
  PHI: number
  PHI_INV: number
  SQRT2: number
  SQRT3: number
  PI: number
  E: number
}>

export declare const HLN_V35_THEMES: readonly HlnV35ThemeId[]
export declare const HLN_V35_THEME_REGISTRY: readonly HlnV35ThemeMetadata[]
export declare const HLN_V35_FONTS: readonly HlnV35FontId[]
export declare const HLN_V35_CJK_FONTS: readonly HlnV35CjkFontId[]
export declare const HLN_V35_BG_PRESETS: readonly Readonly<{
  id: HlnV35BgPresetId
  label: string
  note: string
}>[]
export declare const HLN_V35_MOTION_PRESETS: readonly string[]

export declare function isHlnV35Theme(value: unknown): value is HlnV35ThemeId
export declare function applyHlnV35Theme(root: HTMLElement | null | undefined, themeId: string): HlnV35ThemeId
export declare function applyHlnV35CjkFont(root: HTMLElement | null | undefined, cjkMode?: string): HlnV35CjkFontId
