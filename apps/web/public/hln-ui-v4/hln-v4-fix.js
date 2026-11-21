// ProjectHLN UI System v4 compatibility shim (classic script; no modules).
// Publishes the same surface as the ESM runtime entry (hln-ui-v4/index.js)
// on window.HLN and mirrors the theme onto the legacy data-theme key, so
// template-level integrations work without a bundler entry.
;(function () {
  "use strict"
  var VERSION = "v4"

  var THEME_REGISTRY = [
    { id: "folio-graphite", label: "石墨 Graphite", accent: "#d9a441", accentCool: "#6f9dd1", swatch: "#1c1f23", colorScheme: "dark" },
    { id: "folio-porcelain", label: "瓷白 Porcelain", accent: "#2f4b7c", accentCool: "#3f7d6e", swatch: "#fdfcfa", colorScheme: "light" },
    { id: "folio-pine", label: "苍松 Pine", accent: "#cbb27a", accentCool: "#4f9e83", swatch: "#161e1a", colorScheme: "dark" },
    { id: "folio-slate", label: "靛青 Slate", accent: "#7f9be0", accentCool: "#4f9e94", swatch: "#171b21", colorScheme: "dark" },
    { id: "folio-apricot", label: "杏色 Apricot", accent: "#974725", accentCool: "#35707a", swatch: "#fffaf5", colorScheme: "light" },
    { id: "folio-plum", label: "墨梅 Plum", accent: "#cf8a5a", accentCool: "#a87bc4", swatch: "#1d1822", colorScheme: "dark" },
    { id: "folio-sage", label: "苔青 Sage", accent: "#2d664b", accentCool: "#a8593f", swatch: "#f7f9f5", colorScheme: "light" },
    { id: "folio-lilac", label: "藕荷 Lilac", accent: "#5b4b9e", accentCool: "#a85571", swatch: "#faf9fd", colorScheme: "light" },
    { id: "singularity-cyan", label: "奇点 Singularity Cyan", accent: "#00f0ff", accentCool: "#38bdf8", swatch: "#0f1622", colorScheme: "dark" },
    { id: "tensor-amber", label: "张量 Tensor Amber", accent: "#ffb800", accentCool: "#00f0ff", swatch: "#141922", colorScheme: "dark" },
  ]
  var THEMES = THEME_REGISTRY.map(function (theme) { return theme.id })
  var FONTS = ["grotesque", "display", "editorial", "technical", "geometric", "cyber", "label", "fangsong"]
  var CJK_FONTS = ["auto", "hei", "display", "song", "kai", "mono", "fangsong"]
  var BG_MOTIONS = [
    "tensor-stream", "neural-dag", "fourier-harmonics", "procedural-matrix",
    "simplex-contour", "clock-bus", "swiss-vector", "paper-grain", "tint-wash", "folio-grid", "quiet",
  ]
  var MOTION_VARIANTS = [
    "panel", "item", "rise", "unfold", "spring", "slide-left", "slide-right", "type-in", "page-shift",
  ]

  // Legacy mappings to v4 successors
  var THEME_MIGRATIONS = {
    "cetus-light": "folio-porcelain",
    "alabaster-studio": "folio-porcelain",
    "bauhaus-compiler": "folio-apricot",
    "linear-obsidian": "folio-graphite",
    "linear-platinum": "folio-porcelain",
    "linear-amber": "folio-graphite",
    "linear-paper": "folio-porcelain",
    "linear-emerald": "folio-pine",
    "linear-mono": "folio-slate",
    "veridian-stream": "folio-pine",
    "synapse-violet": "folio-plum",
    "cobalt-manifold": "folio-slate",
    "titanium-oxide": "folio-graphite",
  }
  var FONT_MIGRATIONS = {
    condensed: "grotesque",
    berlin: "geometric",
  }
  var BG_MOTION_MIGRATIONS = {
    "horizon-rule": "swiss-vector",
    "axial-cross": "swiss-vector",
    "parallel-lines": "procedural-matrix",
    "fine-grain-line": "procedural-matrix",
  }

  function resolve(target) {
    return target || document.body
  }

  function rootEl() {
    return document.getElementById("root")
  }

  function isTheme(theme) {
    return THEMES.indexOf(theme) !== -1
  }

  function currentTheme() {
    var el = document.documentElement
    return (el && el.dataset && el.dataset.hlnTheme) || "folio-graphite"
  }

  function applyTheme(theme, target) {
    if (!isTheme(theme)) return false
    document.documentElement.dataset.hlnTheme = theme
    var body = resolve(target)
    if (body && body.dataset) {
      body.dataset.hlnTheme = theme
      body.dataset.theme = theme
      body.dataset.hlnUiVersion = VERSION
    }
    stampRoot("hlnTheme", theme)
    return true
  }

  function stampRoot(dataset, value) {
    var root = rootEl()
    if (root && root.dataset) root.dataset[dataset] = value
  }

  function isFont(font) {
    return FONTS.indexOf(font) !== -1
  }

  function currentFont(target) {
    var el = target || document.body
    return (el && el.dataset && el.dataset.hlnFont) || "grotesque"
  }

  function applyFont(font, target) {
    var el = target || document.body
    if (!el || !el.dataset || !isFont(font)) return false
    el.dataset.hlnFont = font
    stampRoot("hlnFont", font)
    return true
  }

  function isCjkFont(cjkFont) {
    return CJK_FONTS.indexOf(cjkFont) !== -1
  }

  function currentCjkFont(target) {
    var el = target || document.body
    return (el && el.dataset && el.dataset.hlnCjkFont) || "auto"
  }

  function applyCjkFont(cjkFont, target) {
    var el = target || document.body
    if (!el || !el.dataset || !isCjkFont(cjkFont)) return false
    el.dataset.hlnCjkFont = cjkFont
    stampRoot("hlnCjkFont", cjkFont)
    return true
  }

  function isBgMotion(motion) {
    return BG_MOTIONS.indexOf(motion) !== -1
  }

  function currentBgMotion() {
    var root = rootEl()
    return (root && root.dataset && root.dataset.hlnBgMotion) || "tensor-stream"
  }

  function applyBgMotion(motion) {
    var root = rootEl()
    if (!root || !root.dataset || !isBgMotion(motion)) return false
    root.dataset.hlnBgMotion = motion
    return true
  }

  function playMotion(scope, preset, state, variant) {
    if (!scope || typeof window === "undefined") return
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    var selector = "[data-hln-motion=" + JSON.stringify(preset || "panel") + "]"
    var elements = scope.matches && scope.matches(selector)
      ? [scope]
      : Array.prototype.slice.call(scope.querySelectorAll(selector))
    elements.forEach(function (element, index) {
      element.style.setProperty("--hln-ui-motion-index", String(index))
      delete element.dataset.hlnMotionState
      delete element.dataset.hlnMotionVariant
      void element.offsetWidth
      element.dataset.hlnMotionState = state || "enter"
      if (variant) element.dataset.hlnMotionVariant = variant
      element.addEventListener("animationend", function () {
        delete element.dataset.hlnMotionState
        delete element.dataset.hlnMotionVariant
      }, { once: true })
    })
  }

  window.HLN = Object.freeze({
    version: VERSION,
    themeRegistry: Object.freeze(THEME_REGISTRY.map(function (theme) { return Object.freeze(theme) })),
    themes: Object.freeze(THEMES.slice()),
    fonts: Object.freeze(FONTS.slice()),
    cjkFonts: Object.freeze(CJK_FONTS.slice()),
    bgMotions: Object.freeze(BG_MOTIONS.slice()),
    motionVariants: Object.freeze(MOTION_VARIANTS.slice()),
    currentTheme: currentTheme,
    applyTheme: applyTheme,
    isTheme: isTheme,
    currentFont: currentFont,
    applyFont: applyFont,
    isFont: isFont,
    currentCjkFont: currentCjkFont,
    applyCjkFont: applyCjkFont,
    isCjkFont: isCjkFont,
    currentBgMotion: currentBgMotion,
    applyBgMotion: applyBgMotion,
    isBgMotion: isBgMotion,
    playMotion: playMotion,
  })

  // Mirror the static default onto the legacy data-theme key, then restore
  // the stored selection ahead of first paint.
  if (document.body) {
    var initial = currentTheme()
    if (isTheme(initial)) document.body.dataset.theme = initial
  }

  try {
    var saved = JSON.parse(window.localStorage.getItem("cetusprism.hln.ui.v1") || "null")
    if (saved && typeof saved === "object") {
      var theme = isTheme(saved.theme) ? saved.theme : THEME_MIGRATIONS[saved.theme]
      if (theme) applyTheme(theme)
      var font = isFont(saved.font) ? saved.font : FONT_MIGRATIONS[saved.font]
      if (font) applyFont(font)
      var cjk = isCjkFont(saved.cjk) ? saved.cjk : (isCjkFont(saved.cjkFont) ? saved.cjkFont : undefined)
      if (cjk) applyCjkFont(cjk)
      var bgMotion = isBgMotion(saved.bgMotion) ? saved.bgMotion : BG_MOTION_MIGRATIONS[saved.bgMotion]
      if (bgMotion) applyBgMotion(bgMotion)
    }
  } catch (err) {
    // Corrupted or refused storage keeps the index.html defaults
  }
})()
