//! The WebView2 initialization script: the desktop bridge the web surface
//! probes, plus the drag takeover for the frameless titlebar.
//!
//! Electron exposed the same contract through `contextBridge` + `ipcRenderer`;
//! here the injected script forwards to the shell's Tauri commands. The web
//! client consumes only `isDesktop`, `minimize`, `toggleMaximize`, `close`,
//! `openExternal`, and `onWindowStateChange` — the other members exist for
//! contract parity. `openExternal` hands account authorization URLs to the
//! system browser; the command itself rejects every destination that is not
//! HTTPS or loopback HTTP.

/// Runs before any page script on every document load (initialization
/// scripts are injected by the WebView2 host and are not subject to page CSP).
pub const INIT_SCRIPT: &str = r#"(() => {
  if (window.dshDesktop) return
  const invoke = window.__TAURI_INTERNALS__.invoke
  const listeners = []
  window.dshDesktop = {
    isDesktop: true,
    platform: 'win32',
    quit: () => { void invoke('dsh_quit') },
    minimize: () => { void invoke('dsh_minimize') },
    toggleMaximize: () => { void invoke('dsh_toggle_maximize') },
    close: () => { void invoke('dsh_close') },
    openExternal: (url) => { void invoke('dsh_open_external', { url }) },
    notify: (options) => { void invoke('dsh_notify', { title: options.title, body: options.body }) },
    onWindowStateChange: (listener) => {
      listeners.push(listener)
      return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
    },
  }
  window.addEventListener('dsh-desktop:window-state', (event) => {
    for (const listener of [...listeners]) {
      try { listener(!!event.detail) } catch { /* a broken listener must not break the others */ }
    }
  })
  // Drag takeover: the client styles its drag bands with CSS
  // -webkit-app-region, which Chromium computes but only Electron acts on.
  // Electron semantics are nearest-explicit-value-wins: an element inside a
  // drag band whose own region is no-drag (the titlebar control cluster,
  // base.css's interactive-element rule) is not draggable. Walk the ancestor
  // chain and stop at the first explicit value; a bare walk that only looks
  // for 'drag' sees through the no-drag overrides and starts a native drag
  // loop on every titlebar-button mousedown, which eats the click.
  const inDragRegion = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const region = getComputedStyle(node).webkitAppRegion
      if (region === 'drag') return true
      if (region === 'no-drag') return false
    }
    return false
  }
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    if (!inDragRegion(event.target)) return
    void invoke('dsh_start_drag')
  }, true)
})()
"#;
