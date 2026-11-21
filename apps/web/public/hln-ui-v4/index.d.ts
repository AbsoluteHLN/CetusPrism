export declare const HLN_V4_VERSION: "4.0.0"

export type HlnV4ThemeId =
  | "folio-porcelain"
  | "folio-sage"
  | "folio-apricot"
  | "folio-lilac"
  | "folio-graphite"
  | "folio-pine"
  | "folio-plum"
  | "folio-slate"

export type HlnV4FontId =
  | "grotesque"
  | "editorial"
  | "display"
  | "technical"
  | "label"
  | "fangsong"

export type HlnV4CjkFontId =
  | "auto"
  | "hei"
  | "display"
  | "song"
  | "kai"
  | "mono"
  | "fangsong"

export type HlnV4MotionVariant =
  | "rise"
  | "unfold"
  | "spring"
  | "slide-left"
  | "slide-right"
  | "type-in"
  | "page-shift"

export type HlnV4ThemeCategory = "folio-light" | "folio-dark"

export interface HlnV4ThemeMeta {
  id: HlnV4ThemeId
  label: string
  colorScheme: "dark" | "light"
  swatch: string
  accent: string
  accentCool: string
  category: HlnV4ThemeCategory
}

export interface HlnV4BackgroundPreset {
  id: string
  label: string
  note: string
}

export interface HlnV4Skin {
  readonly id: string
  readonly tokens: Readonly<Record<string, string>>
}

export declare const HLN_V4_THEMES: readonly HlnV4ThemeId[]
export declare const HLN_V4_THEME_REGISTRY: readonly HlnV4ThemeMeta[]
export declare const HLN_V4_FONTS: readonly HlnV4FontId[]
export declare const HLN_V4_CJK_FONTS: readonly HlnV4CjkFontId[]
export declare const HLN_V4_BG_PRESETS: readonly HlnV4BackgroundPreset[]
export declare const HLN_V4_MOTION_VARIANTS: readonly HlnV4MotionVariant[]
export declare const HLN_V4_SKIN_TOKENS: readonly string[]

export declare function isHlnV4Theme(value: unknown): value is HlnV4ThemeId
export declare function applyHlnV4Theme(
  root: HTMLElement | { dataset?: DOMStringMap },
  themeId?: HlnV4ThemeId | string,
): HlnV4ThemeId
export declare function applyHlnV4CjkFont(
  root: HTMLElement | { dataset?: DOMStringMap },
  cjkMode?: HlnV4CjkFontId | string,
): HlnV4CjkFontId
export declare function applyHlnV4Font(
  root: HTMLElement | { dataset?: DOMStringMap },
  fontId?: HlnV4FontId | string,
): HlnV4FontId
export declare function applyHlnV4Background(
  root: HTMLElement | { dataset?: DOMStringMap },
  bgId?: string,
): string
export declare function playHlnMotion(
  scope: Element | Element[] | null | undefined,
  preset?: "panel" | "item" | "control",
  variant?: HlnV4MotionVariant | string,
): number
export declare function hlnFlip(element: HTMLElement | null | undefined): void
export declare function createHlnSkin(skin: HlnV4Skin | { id: string; tokens: Record<string, string> }): HlnV4Skin
export declare function applyHlnSkin(
  root: HTMLElement,
  skin: HlnV4Skin | { id: string; tokens: Record<string, string> },
): () => void
