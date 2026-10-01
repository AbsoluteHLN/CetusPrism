// ProjectHLN UI System v3.2 compatibility shim (classic script; no modules).
// Publishes the same surface as the ESM runtime entry (hln-ui-v3.2/index.js)
// on window.HLN and mirrors the body theme onto the legacy data-theme key,
// so template-level integrations work without a bundler entry.
//
// Catalog data mirrors the v3.2 dist registry (6 themes / 5 fonts / 7 CJK
// fonts / 5 background presets / 8 motion variants). Font and CJK modes are
// stamped on #root as well as the target: the v3.2 base layer rebinds its
// five font stacks with the active CJK override only on
// [data-hln-ui-root][data-hln-font] / [data-hln-ui-root][data-hln-cjk-font],
// so the mode must stand on the UI root for the app content to pick it up.
;(function () {
  "use strict"
  var VERSION = "v3.2"
  var THEME_REGISTRY = [
    { id: "linear-obsidian", label: "Linear Obsidian", accent: "#38bdf8", swatch: "#10141a", colorScheme: "dark" },
    { id: "linear-platinum", label: "Linear Platinum", accent: "#2563eb", swatch: "#ffffff", colorScheme: "light" },
    { id: "linear-amber", label: "Linear Amber", accent: "#f59e0b", swatch: "#12161c", colorScheme: "dark" },
    { id: "linear-paper", label: "Linear Paper", accent: "#0d9488", swatch: "#faf9f5", colorScheme: "light" },
    { id: "linear-emerald", label: "Linear Emerald", accent: "#10b981", swatch: "#0f1714", colorScheme: "dark" },
    { id: "linear-mono", label: "Linear Mono", accent: "#f4f4f5", swatch: "#121215", colorScheme: "dark" },
  ]
  var THEMES = THEME_REGISTRY.map(function (theme) { return theme.id })
  var FONTS = ["geometric", "grotesque", "editorial", "technical", "display"]
  var CJK_FONTS = ["auto", "hei", "display", "song", "kai", "mono", "fangsong"]
  var BG_MOTIONS = ["horizon-rule", "axial-cross", "parallel-lines", "fine-grain-line", "quiet"]
  var MOTION_VARIANTS = [
    "panel", "item", "line-extend", "plane-glide", "axis-reveal", "rail-draw", "type-in", "page-shift",
  ]

  // The settings panel once persisted v2.3 ids under the same storage key;
  // migrate them instead of resetting the whole selection.
  var THEME_MIGRATIONS = { "cetus-light": "linear-paper" }
  var FONT_MIGRATIONS = { cyber: "geometric", berlin: "editorial", condensed: "grotesque" }

  function resolve(target) {
    return target || document.body
  }

  function rootEl() {
    return document.getElementById("root")
  }

  function isTheme(theme) {
    return THEMES.indexOf(theme) !== -1
  }

  function currentTheme(target) {
    var el = target || document.body
    return (el && el.dataset && el.dataset.hlnTheme) || "linear-obsidian"
  }

  function applyTheme(theme, target) {
    var el = target || document.body
    if (!el || !el.dataset || !isTheme(theme)) return false
    el.dataset.hlnTheme = theme
    el.dataset.theme = theme
    // The dist's applyHlnV32Theme roots the version marker with the theme.
    el.dataset.hlnUiVersion = VERSION
    // The v3.2 base block roots its obsidian default palette on
    // [data-hln-ui-root], and an element's own declaration beats inheritance:
    // a theme stamped only on body never re-points the vars the app resolves
    // inside #root. Fonts stamp the root for the same reason.
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
    return (root && root.dataset && root.dataset.hlnBgMotion) || "horizon-rule"
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

  if (document.body) {
    var initial = currentTheme()
    if (isTheme(initial)) document.body.dataset.theme = initial
  }

  // Restore the selection last persisted by the settings panel
  // (cetusprism.hln.ui.v1), ahead of the index.html defaults, with the same
  // migrations the settings catalog applies.
  try {
    var saved = JSON.parse(window.localStorage.getItem("cetusprism.hln.ui.v1") || "null")
    if (saved && typeof saved === "object") {
      var theme = isTheme(saved.theme) ? saved.theme : THEME_MIGRATIONS[saved.theme]
      if (theme) applyTheme(theme)
      var font = isFont(saved.font) ? saved.font : FONT_MIGRATIONS[saved.font]
      if (font) applyFont(font)
      if (isCjkFont(saved.cjkFont)) applyCjkFont(saved.cjkFont)
      if (isBgMotion(saved.bgMotion)) applyBgMotion(saved.bgMotion)
    }
  } catch (err) {
    // Corrupted or refused storage keeps the index.html defaults; nothing else can reach it.
  }
})()
