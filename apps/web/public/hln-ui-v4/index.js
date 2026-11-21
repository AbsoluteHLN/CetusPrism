// ProjectHLN UI System v4 - Folio Runtime (index.js)
// Calm minimal multi-pigment edition. Dependency-free ES module.
// Safe to import in Node: every DOM access is guarded.

export const HLN_V4_VERSION = "4.0.0"

export const HLN_V4_THEMES = Object.freeze([
  "folio-porcelain",
  "folio-sage",
  "folio-apricot",
  "folio-lilac",
  "folio-graphite",
  "folio-pine",
  "folio-plum",
  "folio-slate",
])

export const HLN_V4_THEME_REGISTRY = Object.freeze([
  {
    id: "folio-porcelain",
    label: "瓷白 Porcelain",
    colorScheme: "light",
    swatch: "#fdfcfa",
    accent: "#2f4b7c",
    accentCool: "#3f7d6e",
    category: "folio-light",
  },
  {
    id: "folio-sage",
    label: "苔青 Sage",
    colorScheme: "light",
    swatch: "#f7f9f5",
    accent: "#2d664b",
    accentCool: "#a8593f",
    category: "folio-light",
  },
  {
    id: "folio-apricot",
    label: "杏色 Apricot",
    colorScheme: "light",
    swatch: "#fffaf5",
    accent: "#974725",
    accentCool: "#35707a",
    category: "folio-light",
  },
  {
    id: "folio-lilac",
    label: "藕荷 Lilac",
    colorScheme: "light",
    swatch: "#faf9fd",
    accent: "#5b4b9e",
    accentCool: "#a85571",
    category: "folio-light",
  },
  {
    id: "folio-graphite",
    label: "石墨 Graphite",
    colorScheme: "dark",
    swatch: "#1c1f23",
    accent: "#d9a441",
    accentCool: "#6f9dd1",
    category: "folio-dark",
  },
  {
    id: "folio-pine",
    label: "苍松 Pine",
    colorScheme: "dark",
    swatch: "#161e1a",
    accent: "#cbb27a",
    accentCool: "#4f9e83",
    category: "folio-dark",
  },
  {
    id: "folio-plum",
    label: "墨梅 Plum",
    colorScheme: "dark",
    swatch: "#1d1822",
    accent: "#cf8a5a",
    accentCool: "#a87bc4",
    category: "folio-dark",
  },
  {
    id: "folio-slate",
    label: "靛青 Slate",
    colorScheme: "dark",
    swatch: "#171b21",
    accent: "#7f9be0",
    accentCool: "#4f9e94",
    category: "folio-dark",
  },
])

export const HLN_V4_FONTS = Object.freeze([
  "grotesque",
  "editorial",
  "display",
  "technical",
  "label",
  "fangsong",
])

export const HLN_V4_CJK_FONTS = Object.freeze([
  "auto",
  "hei",
  "display",
  "song",
  "kai",
  "mono",
  "fangsong",
])

export const HLN_V4_BG_PRESETS = Object.freeze([
  { id: "paper-grain", label: "Paper Grain", note: "fine warm fibre grain" },
  { id: "margin-rule", label: "Margin Rule", note: "single margin hairline" },
  { id: "tint-wash", label: "Tint Wash", note: "broad pigment wash" },
  { id: "ruled-lines", label: "Ruled Lines", note: "32px writing rules" },
  { id: "folio-grid", label: "Folio Grid", note: "40px baseline grid" },
  { id: "vellum-fiber", label: "Vellum Fiber", note: "soft vertical fibre" },
  { id: "quiet", label: "Quiet", note: "flat matte, no ornament" },
])

export const HLN_V4_MOTION_VARIANTS = Object.freeze([
  "rise",
  "unfold",
  "spring",
  "slide-left",
  "slide-right",
  "type-in",
  "page-shift",
])

export const HLN_V4_SKIN_TOKENS = Object.freeze([
  "--hln-ui-accent",
  "--hln-ui-accent-cool",
  "--hln-ui-on-accent",
  "--hln-ui-bg-0",
  "--hln-ui-bg-1",
  "--hln-ui-bg-2",
  "--hln-ui-panel-bg",
  "--hln-ui-text",
  "--hln-ui-text-muted",
  "--hln-ui-text-faint",
  "--hln-ui-line",
  "--hln-ui-line-strong",
  "--hln-ui-focus",
  "--hln-ui-success",
  "--hln-ui-warning",
  "--hln-ui-danger",
])

const SKIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/
const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[a-z0-9-]+\))$/

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function isHlnV4Theme(value) {
  return typeof value === "string" && HLN_V4_THEMES.includes(value)
}

export function applyHlnV4Theme(root, themeId) {
  const resolved = isHlnV4Theme(themeId) ? themeId : HLN_V4_THEMES[0]
  if (root && root.dataset) {
    root.dataset.hlnTheme = resolved
    root.dataset.theme = resolved
  }
  return resolved
}

export function applyHlnV4CjkFont(root, cjkMode = "auto") {
  const resolved = HLN_V4_CJK_FONTS.includes(cjkMode) ? cjkMode : "auto"
  if (root && root.dataset) {
    root.dataset.hlnCjkFont = resolved
  }
  return resolved
}

export function applyHlnV4Font(root, fontId) {
  const resolved = HLN_V4_FONTS.includes(fontId) ? fontId : HLN_V4_FONTS[0]
  if (root && root.dataset) {
    root.dataset.hlnFont = resolved
  }
  return resolved
}

export function applyHlnV4Background(root, bgId) {
  const resolved = HLN_V4_BG_PRESETS.some((preset) => preset.id === bgId)
    ? bgId
    : HLN_V4_BG_PRESETS[0].id
  if (root && root.dataset) {
    root.dataset.hlnBgMotion = resolved
  }
  return resolved
}

function collectMotionTargets(scope, preset) {
  if (!scope) return []
  const selector = `[data-hln-motion="${preset}"]`
  const self = typeof scope.matches === "function" && scope.matches(selector) ? [scope] : []
  const children =
    typeof scope.querySelectorAll === "function" ? [...scope.querySelectorAll(selector)] : []
  return [...self, ...children]
}

export function playHlnMotion(scope, preset = "panel", variant) {
  if (prefersReducedMotion()) return 0
  const targets = collectMotionTargets(scope, preset)
  targets.forEach((element, index) => {
    if (!element || !element.dataset) return
    element.style.setProperty("--hln-ui-motion-index", String(index))
    delete element.dataset.hlnMotionState
    delete element.dataset.hlnMotionVariant
    void element.offsetWidth
    element.dataset.hlnMotionState = "enter"
    if (variant && HLN_V4_MOTION_VARIANTS.includes(variant)) {
      element.dataset.hlnMotionVariant = variant
    }
  })
  return targets.length
}

export function hlnFlip(element) {
  if (!element || !element.style || prefersReducedMotion()) return
  const previousTransition = element.style.transition
  const previousTransform = element.style.transform
  element.style.transition = "transform 220ms var(--hln-ui-ease), opacity 220ms var(--hln-ui-ease)"
  element.style.transform = "translate3d(0, 0, 0)"
  void element.offsetWidth
  const restore = () => {
    element.style.transition = previousTransition
    element.style.transform = previousTransform
    element.removeEventListener("transitionend", restore)
  }
  element.addEventListener("transitionend", restore, { once: true })
}

export function createHlnSkin(skin) {
  if (!skin || typeof skin !== "object") {
    throw new TypeError("createHlnSkin expects a skin object with { id, tokens }")
  }
  const { id, tokens } = skin
  if (typeof id !== "string" || !SKIN_ID_PATTERN.test(id)) {
    throw new TypeError("createHlnSkin: skin id must match /^[a-z0-9][a-z0-9-]{1,40}$/")
  }
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    throw new TypeError("createHlnSkin: skin tokens must be a plain object")
  }
  const validated = {}
  for (const [key, value] of Object.entries(tokens)) {
    if (!HLN_V4_SKIN_TOKENS.includes(key)) {
      throw new TypeError(`createHlnSkin: token "${key}" is not allowlisted`)
    }
    if (typeof value !== "string" || !COLOR_PATTERN.test(value.trim())) {
      throw new TypeError(`createHlnSkin: token "${key}" has an invalid colour value`)
    }
    validated[key] = value.trim()
  }
  return Object.freeze({ id, tokens: Object.freeze(validated) })
}

export function applyHlnSkin(root, skin) {
  if (!root || !root.style) {
    throw new TypeError("applyHlnSkin requires a host root element")
  }
  const resolved = skin && skin.id && skin.tokens ? createHlnSkin(skin) : skin
  const previous = new Map()
  for (const [key, value] of Object.entries(resolved.tokens)) {
    previous.set(key, root.style.getPropertyValue(key))
    root.style.setProperty(key, value)
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value) root.style.setProperty(key, value)
      else root.style.removeProperty(key)
    }
  }
}
