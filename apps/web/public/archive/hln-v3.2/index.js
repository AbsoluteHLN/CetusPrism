// ProjectHLN UI System v3.2 - Subtractive Linear Architecture Runtime Registry
export const HLN_V32_VERSION = "3.2.0"

export const HLN_V32_MATH_CONSTANTS = Object.freeze({
  PHI: 1.6180339887,
  INV_PHI: 0.6180339887,
  SQRT2: 1.4142135623,
})

export const HLN_V32_THEMES = Object.freeze([
  "linear-obsidian",
  "linear-platinum",
  "linear-amber",
  "linear-paper",
  "linear-emerald",
  "linear-mono",
])

export const HLN_V32_THEME_REGISTRY = Object.freeze([
  {
    id: "linear-obsidian",
    label: "Linear Obsidian",
    accent: "#38bdf8",
    swatch: "#10141a",
    colorScheme: "dark",
    description: "Deep obsidian plane with sky-cyan 1px structural hairlines.",
  },
  {
    id: "linear-platinum",
    label: "Linear Platinum",
    accent: "#2563eb",
    swatch: "#ffffff",
    colorScheme: "light",
    description: "Warm platinum gallery canvas with cobalt architectural hairlines.",
  },
  {
    id: "linear-amber",
    label: "Linear Amber",
    accent: "#f59e0b",
    swatch: "#12161c",
    colorScheme: "dark",
    description: "Deep carbon slate with warm horizon gold linear rules.",
  },
  {
    id: "linear-paper",
    label: "Linear Paper",
    accent: "#0d9488",
    swatch: "#faf9f5",
    colorScheme: "light",
    description: "Gallery vellum paper with mineral teal hairline proportions.",
  },
  {
    id: "linear-emerald",
    label: "Linear Emerald",
    accent: "#10b981",
    swatch: "#0f1714",
    colorScheme: "dark",
    description: "Mineral dark slate with precision emerald linear rules.",
  },
  {
    id: "linear-mono",
    label: "Linear Mono",
    accent: "#f4f4f5",
    swatch: "#121215",
    colorScheme: "dark",
    description: "Pure monochrome ink with stark white 1px structural lines.",
  },
])

export const HLN_V32_FONTS = Object.freeze([
  "geometric",
  "grotesque",
  "editorial",
  "technical",
  "display",
])

export const HLN_V32_CJK_FONTS = Object.freeze([
  "auto",
  "hei",
  "display",
  "song",
  "kai",
  "mono",
  "fangsong",
])

export const HLN_V32_BG_PRESETS = Object.freeze([
  { id: "horizon-rule", label: "Horizon Rule", note: "61.8% golden horizon & linear sweep" },
  { id: "axial-cross", label: "Axial Cross", note: "Single origin crosshair & pulse" },
  { id: "parallel-lines", label: "Parallel Columns", note: "96px vertical architectural lines" },
  { id: "fine-grain-line", label: "Baseline Grid", note: "64px sparse linear baseline" },
  { id: "quiet", label: "Quiet Plane", note: "Pure matte void" },
])

export const HLN_V32_MOTION_VARIANTS = Object.freeze([
  "panel",
  "item",
  "line-extend",
  "plane-glide",
  "axis-reveal",
  "rail-draw",
  "type-in",
  "page-shift",
])

export function applyHlnV32Theme(root, themeId = "linear-obsidian") {
  const valid = HLN_V32_THEMES.includes(themeId) ? themeId : "linear-obsidian"
  if (root?.dataset) {
    root.dataset.hlnUiVersion = "v3.2"
    root.dataset.hlnTheme = valid
  }
  return valid
}

export function applyHlnV32CjkFont(root, cjkFontId = "auto") {
  const valid = HLN_V32_CJK_FONTS.includes(cjkFontId) ? cjkFontId : "auto"
  if (root?.dataset) {
    root.dataset.hlnCjkFont = valid
  }
  return valid
}
