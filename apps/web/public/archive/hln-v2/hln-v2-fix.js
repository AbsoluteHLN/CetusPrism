// ProjectHLN UI System v2.3 compatibility shim (classic script; no modules).
// Publishes the same surface as the ESM runtime entry (hln-ui-v2.3/index.js)
// on window.HLN and mirrors the body theme onto the legacy data-theme key,
// so template-level integrations work without a bundler entry.
;(function () {
  "use strict"
  var THEMES = ["arknights", "endfield", "blacksteel", "abyss-aegir", "babel", "monster-siren", "cetus-light"]
  var FONTS = ["display", "technical", "grotesque", "cyber", "berlin", "condensed"]
  var BG_MOTIONS = [
    "tactical-grid", "holo-scan", "circuit-trace", "prts-sonar", "hazard-hatch",
    "hex-field", "radar-cross", "data-rain", "blueprint", "data-lattice",
    "blueprint-schematic", "quiet",
  ]

  function resolve(target) {
    return target || document.body
  }

  function isTheme(theme) {
    return THEMES.indexOf(theme) !== -1
  }

  function currentTheme(target) {
    var el = target || document.body
    return (el && el.dataset && el.dataset.hlnTheme) || "arknights"
  }

  function applyTheme(theme, target) {
    var el = target || document.body
    if (!el || !el.dataset || !isTheme(theme)) return false
    el.dataset.hlnTheme = theme
    el.dataset.theme = theme
    return true
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
    return true
  }

  function isBgMotion(motion) {
    return BG_MOTIONS.indexOf(motion) !== -1
  }

  function currentBgMotion() {
    var root = document.getElementById("root")
    return (root && root.dataset && root.dataset.hlnBgMotion) || "tactical-grid"
  }

  function applyBgMotion(motion) {
    var root = document.getElementById("root")
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
    version: "v2.3",
    themes: Object.freeze(THEMES.slice()),
    fonts: Object.freeze(FONTS.slice()),
    bgMotions: Object.freeze(BG_MOTIONS.slice()),
    currentTheme: currentTheme,
    applyTheme: applyTheme,
    isTheme: isTheme,
    currentFont: currentFont,
    applyFont: applyFont,
    isFont: isFont,
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
  // (cetusprism.hln.ui.v1), ahead of the index.html attribute defaults.
  try {
    var saved = JSON.parse(window.localStorage.getItem("cetusprism.hln.ui.v1") || "null")
    if (saved && typeof saved === "object") {
      if (isTheme(saved.theme)) applyTheme(saved.theme)
      if (isFont(saved.font)) applyFont(saved.font)
      if (isBgMotion(saved.bgMotion)) applyBgMotion(saved.bgMotion)
    }
  } catch (err) {
    // Corrupted or refused storage keeps the index.html defaults; nothing else can reach it.
  }
})()
