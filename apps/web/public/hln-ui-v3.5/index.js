// ProjectHLN UI System v3.5 - Algorithmic Vector, AI-Native, Procedural & Data-Stream Runtime (index.js)
// Zero game terminology.

export const HLN_V35_MATH_CONSTANTS = Object.freeze({
  PHI: 1.618033988749895,
  PHI_INV: 0.6180339887498949,
  SQRT2: 1.4142135623730951,
  SQRT3: 1.7320508075688772,
  PI: 3.141592653589793,
  E: 2.718281828459045,
})

export const HLN_V35_THEMES = Object.freeze([
  "singularity-cyan",
  "tensor-amber",
  "veridian-stream",
  "synapse-violet",
  "cobalt-manifold",
  "titanium-oxide",
  "alabaster-studio",
  "bauhaus-compiler",
])

export const HLN_V35_THEME_REGISTRY = Object.freeze([
  {
    id: "singularity-cyan",
    label: "Singularity Cyan",
    colorScheme: "dark",
    swatch: "#0f1622",
    accent: "#00f0ff",
    category: "algorithmic-dark",
  },
  {
    id: "tensor-amber",
    label: "Tensor Amber",
    colorScheme: "dark",
    swatch: "#141922",
    accent: "#ffb800",
    category: "procedural-dark",
  },
  {
    id: "veridian-stream",
    label: "Veridian Stream",
    colorScheme: "dark",
    swatch: "#0d1d1a",
    accent: "#00e699",
    category: "datastream-dark",
  },
  {
    id: "synapse-violet",
    label: "Synapse Violet",
    colorScheme: "dark",
    swatch: "#131024",
    accent: "#b366ff",
    category: "neural-dark",
  },
  {
    id: "cobalt-manifold",
    label: "Cobalt Manifold",
    colorScheme: "dark",
    swatch: "#0d1b2e",
    accent: "#38bdf8",
    category: "manifold-dark",
  },
  {
    id: "titanium-oxide",
    label: "Titanium Oxide",
    colorScheme: "dark",
    swatch: "#161920",
    accent: "#f8fafc",
    category: "surgical-dark",
  },
  {
    id: "alabaster-studio",
    label: "Alabaster Studio",
    colorScheme: "light",
    swatch: "#ffffff",
    accent: "#2563eb",
    category: "studio-light",
  },
  {
    id: "bauhaus-compiler",
    label: "Bauhaus Compiler",
    colorScheme: "light",
    swatch: "#fcfaf5",
    accent: "#dc2626",
    category: "compiler-light",
  },
])

export const HLN_V35_FONTS = Object.freeze([
  "geometric",
  "display",
  "technical",
  "grotesque",
  "cyber",
  "berlin",
  "editorial",
  "label",
])

export const HLN_V35_CJK_FONTS = Object.freeze([
  "auto",
  "hei",
  "display",
  "song",
  "kai",
  "mono",
  "fangsong",
])

export const HLN_V35_BG_PRESETS = Object.freeze([
  { id: "tensor-stream", label: "Tensor Data Stream", note: "bidirectional vector packet flow" },
  { id: "neural-dag", label: "Neural DAG Lattice", note: "directed acyclic node mesh" },
  { id: "fourier-harmonics", label: "Fourier Harmonics", note: "phase-shifted wave interference" },
  { id: "procedural-matrix", label: "Procedural Register", note: "quantized 96px/24px register grid" },
  { id: "simplex-contour", label: "Simplex Manifold", note: "topographical vector locus" },
  { id: "clock-bus", label: "Synchronous Bus", note: "parallel program clock traces" },
  { id: "swiss-vector", label: "Swiss Vector Plane", note: "minimalist 32px crosshair grid" },
  { id: "quiet", label: "Studio Quiet", note: "zero background motion" },
])

export const HLN_V35_MOTION_PRESETS = Object.freeze([
  "panel",
  "item",
  "stream-cascade",
  "tensor-fold",
  "compile-lock",
  "wave-propagate",
  "vector-construct",
  "golden-iris",
  "rail-draw",
  "type-in",
  "page-shift",
])

export function isHlnV35Theme(value) {
  return typeof value === "string" && HLN_V35_THEMES.includes(value)
}

export function applyHlnV35Theme(root, themeId) {
  const resolved = isHlnV35Theme(themeId) ? themeId : HLN_V35_THEMES[0]
  if (root && root.dataset) {
    root.dataset.hlnTheme = resolved
  }
  return resolved
}

export function applyHlnV35CjkFont(root, cjkMode = "auto") {
  const resolved = HLN_V35_CJK_FONTS.includes(cjkMode) ? cjkMode : "auto"
  if (root && root.dataset) {
    root.dataset.hlnCjkFont = resolved
  }
  return resolved
}
