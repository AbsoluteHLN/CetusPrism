// ProjectHLN UI System v3.5 compatibility shim (classic script; no modules).
// Publishes the same surface as the ESM runtime entry (hln-ui-v3.5/index.js)
// on window.HLN and mirrors the theme onto the legacy data-theme key, so
// template-level integrations work without a bundler entry.
//
// Catalog data mirrors the v3.5 dist registry (8 themes / 8 fonts / 7 CJK
// fonts / 8 background presets / 11 motion presets). The v3.5 theme layer
// roots its palettes on :root[data-hln-theme] as well as
// [data-hln-ui-root][data-hln-theme], so the selected theme is stamped on
// <html> as well as #root: the integration stylesheet resolves its
// --hln-ui-* references on html body, and custom properties set only on
// #root never propagate up to the body-level alias mapping. Fonts and CJK
// modes are stamped on #root: the v3.5 base layer rebinds its font stacks
// with the active CJK override only on
// [data-hln-ui-root][data-hln-font] / [data-hln-ui-root][data-hln-cjk-font].
;(function () {
  "use strict"
  var VERSION = "v3.5"
  var THEME_REGISTRY = [
    { id: "singularity-cyan", label: "Singularity Cyan", accent: "#00f0ff", swatch: "#0f1622", colorScheme: "dark" },
    { id: "tensor-amber", label: "Tensor Amber", accent: "#ffb800", swatch: "#141922", colorScheme: "dark" },
    { id: "veridian-stream", label: "Veridian Stream", accent: "#00e699", swatch: "#0d1d1a", colorScheme: "dark" },
    { id: "synapse-violet", label: "Synapse Violet", accent: "#b366ff", swatch: "#131024", colorScheme: "dark" },
    { id: "cobalt-manifold", label: "Cobalt Manifold", accent: "#38bdf8", swatch: "#0d1b2e", colorScheme: "dark" },
    { id: "titanium-oxide", label: "Titanium Oxide", accent: "#f8fafc", swatch: "#161920", colorScheme: "dark" },
    { id: "alabaster-studio", label: "Alabaster Studio", accent: "#2563eb", swatch: "#ffffff", colorScheme: "light" },
    { id: "bauhaus-compiler", label: "Bauhaus Compiler", accent: "#dc2626", swatch: "#fcfaf5", colorScheme: "light" },
  ]
  var THEMES = THEME_REGISTRY.map(function (theme) { return theme.id })
  var FONTS = ["geometric", "display", "technical", "grotesque", "cyber", "berlin", "editorial", "label"]
  var CJK_FONTS = ["auto", "hei", "display", "song", "kai", "mono", "fangsong"]
  var BG_MOTIONS = [
    "tensor-stream", "neural-dag", "fourier-harmonics", "procedural-matrix",
    "simplex-contour", "clock-bus", "swiss-vector", "quiet",
  ]
  var MOTION_VARIANTS = [
    "panel", "item", "stream-cascade", "tensor-fold", "compile-lock", "wave-propagate",
    "vector-construct", "golden-iris", "rail-draw", "type-in", "page-shift",
  ]

  // Selections persisted by earlier integrations under the same storage key:
  // the v2.3 ids and the v3.2 linear planes migrate onto their v3.5
  // successors instead of resetting the whole selection.
  var THEME_MIGRATIONS = {
    "cetus-light": "alabaster-studio",
    "linear-obsidian": "singularity-cyan",
    "linear-platinum": "alabaster-studio",
    "linear-amber": "tensor-amber",
    "linear-paper": "alabaster-studio",
    "linear-emerald": "veridian-stream",
    "linear-mono": "titanium-oxide",
  }
  var FONT_MIGRATIONS = { condensed: "grotesque" }
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
    return (el && el.dataset && el.dataset.hlnTheme) || "singularity-cyan"
  }

  function applyTheme(theme, target) {
    if (!isTheme(theme)) return false
    // The v3.5 theme layer roots palettes on :root[data-hln-theme] and on
    // [data-hln-ui-root][data-hln-theme]. The :root block must win because
    // the integration layer resolves its --hln-ui-* references on html body;
    // an element's own declaration beats inheritance, so the body-level
    // alias mapping would otherwise only ever see the root default palette.
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

  function isTheme(theme) {
    return THEMES.indexOf(theme) !== -1
  }

  function isFont(font) {
    return FONTS.indexOf(font) !== -1
  }

  function currentFont(target) {
    var el = target || document.body
    return (el && el.dataset && el.dataset.hlnFont) || "display"
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
  // the stored selection (cetusprism.hln.ui.v1) ahead of first paint, with
  // the same migrations the settings catalog applies.
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
      if (isCjkFont(saved.cjkFont)) applyCjkFont(saved.cjkFont)
      var bgMotion = isBgMotion(saved.bgMotion) ? saved.bgMotion : BG_MOTION_MIGRATIONS[saved.bgMotion]
      if (bgMotion) applyBgMotion(bgMotion)
    }
  } catch (err) {
    // Corrupted or refused storage keeps the index.html defaults; nothing else can reach it.
  }
})()
