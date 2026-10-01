// ProjectHLN UI System v2 - ESM runtime entry
// HyperGryph Tactical Vector Design System

export const HLN_V2_THEMES = Object.freeze([
  "arknights",
  "endfield",
  "rhodes-island",
  "monster-siren",
  "rhine-lab",
  "blacksteel",
  "babel",
  "victoria-steam",
  "abyss-aegir",
])

export const HLN_V2_THEME_REGISTRY = Object.freeze([
  { id: "arknights",      label: "Arknights Tactical", swatch: "#131920", accent: "#00e5ff", colorScheme: "dark" },
  { id: "endfield",       label: "Endfield Industry",  swatch: "#121c22", accent: "#f6d000", colorScheme: "dark" },
  { id: "rhodes-island",  label: "PRTS Clinical",     swatch: "#ffffff", accent: "#009cb8", colorScheme: "light" },
  { id: "monster-siren",  label: "Monster Siren",     swatch: "#101015", accent: "#ff0055", colorScheme: "dark" },
  { id: "rhine-lab",      label: "Rhine Lab",         swatch: "#ffffff", accent: "#00aa66", colorScheme: "light" },
  { id: "blacksteel",     label: "Blacksteel PMC",    swatch: "#141418", accent: "#ff9100", colorScheme: "dark" },
  { id: "babel",          label: "Babel Core",        swatch: "#120e20", accent: "#a855f7", colorScheme: "dark" },
  { id: "victoria-steam", label: "Victoria Steam",    swatch: "#fffdf9", accent: "#b35b3c", colorScheme: "light" },
  { id: "abyss-aegir",    label: "Abyss Aegir",       swatch: "#091a28", accent: "#00ffd5", colorScheme: "dark" },
])

export const HLN_V2_BG_PRESETS = Object.freeze([
  { id: "tactical-grid", label: "Tactical Hex Grid", note: "precision coordinate scan" },
  { id: "holo-scan",     label: "Cyber Laser Scan",  note: "laser scanline sweep" },
  { id: "nebula-flow",   label: "Nebula Particle",   note: "deep cosmic particles" },
  { id: "prts-sonar",    label: "PRTS Sonar Sweep",  note: "circular tactical radar" },
  { id: "quantum-wave",  label: "Quantum Glitch",    note: "dynamic signal warp" },
  { id: "aurora",        label: "Aurora Cosmic",     note: "aurora luminescence veil" },
  { id: "quiet",         label: "Static Quiet",      note: "zero background motion" },
])

export const HLN_V2_FONTS = Object.freeze([
  "display",
  "body",
  "classic",
  "technical",
])

export function isHlnV2Theme(theme) {
  return HLN_V2_THEMES.includes(theme)
}

export function applyHlnV2Theme(theme, target = typeof document !== "undefined" ? document.body : null) {
  if (!target || !isHlnV2Theme(theme)) return false
  target.dataset.hlnTheme = theme
  target.dataset.theme = theme
  return true
}

export function currentHlnV2Theme(target = typeof document !== "undefined" ? document.body : null) {
  return target?.dataset?.hlnTheme ?? "arknights"
}

export function isHlnV2Font(font) {
  return HLN_V2_FONTS.includes(font)
}

export function applyHlnV2Font(font, target = typeof document !== "undefined" ? document.body : null) {
  if (!target || !isHlnV2Font(font)) return false
  target.dataset.hlnFont = font
  return true
}

export function currentHlnV2Font(target = typeof document !== "undefined" ? document.body : null) {
  return target?.dataset?.hlnFont ?? "display"
}

export function playHlnV2Motion(scope, preset = "panel", state = "enter", variant) {
  if (!scope || typeof window === "undefined") return
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const selector = `[data-hln-motion="${preset}"]`
  const elements = scope.matches?.(selector) ? [scope] : [...scope.querySelectorAll(selector)]
  elements.forEach((element, index) => {
    element.style.setProperty("--hln-ui-motion-index", String(index))
    element.dataset.hlnMotionState = state
    if (variant) element.dataset.hlnMotionVariant = variant
    element.addEventListener("animationend", () => {
      delete element.dataset.hlnMotionState
      delete element.dataset.hlnMotionVariant
    }, { once: true })
  })
}

export * from "./runtime-transport.js"
