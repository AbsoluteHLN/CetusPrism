#!/usr/bin/env node
/**
 * Release-build the Tauri desktop shell (`src-tauri`) with the pinned
 * toolchain from the dependency cache. The produced executable already
 * carries the product icon and version metadata (embedded at compile time),
 * so `make-installer.mjs` skips its rcedit pass.
 *
 * Toolchain inputs resolve like every other runtime input: the Rust
 * toolchain and the cargo registry cache live in the dependency cache, and
 * the build is offline. The incremental target tree defaults to the cache's
 * cargo folder (`cargo/targets/cetusprism`); `CARGO_TARGET_DIR` may redirect
 * it further.
 *
 * Usage: `node scripts/build-shell.mjs`.
 * @module @deepseek-ai/dsh-electron/build-shell
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const projectDir = join(appRoot, 'src-tauri')

const cargoHome = process.env.CARGO_HOME ?? 'E:/dependency-cache/cargo'
const rustupHome = process.env.RUSTUP_HOME ?? 'E:/dependency-cache/rustup'
// The incremental build cache lives in the dependency cache's cargo folder,
// not in the project tree (the project keeps source and shipped products).
const targetDir = process.env.CARGO_TARGET_DIR
  ?? 'E:/dependency-cache/cargo/targets/cetusprism'

/**
 * Resolve cargo.exe like every other runtime input: from the dependency
 * cache. The toolchain binaries live under the rustup toolchains after the
 * 2026-09-25 cache consolidation (CARGO_HOME keeps only the registry), so a
 * stable toolchain wins and any installed toolchain is a fallback; a
 * CARGO_HOME bin shim, when present, still wins as the direct proxy.
 */
function resolveCargo() {
  const candidates = [join(cargoHome, 'bin', 'cargo.exe')]
  const toolchainsDir = join(rustupHome, 'toolchains')
  if (existsSync(toolchainsDir)) {
    const names = readdirSync(toolchainsDir).sort((left, right) => {
      const stable = (name) => name.startsWith('stable') ? 0 : 1
      return stable(left) - stable(right)
    })
    for (const name of names) candidates.push(join(toolchainsDir, name, 'bin', 'cargo.exe'))
  }
  return candidates.find(existsSync)
}

const cargoExe = resolveCargo()

for (const [label, path] of [['cargo.exe', cargoExe], ['cargo registry', join(cargoHome, 'registry')]]) {
  if (!existsSync(path)) {
    console.error(`build-shell: ${label} missing at ${path ?? '(no candidate)'}`)
    process.exit(1)
  }
}

console.log('build-shell: cargo build --release --offline ...')
execFileSync(cargoExe, ['build', '--release', '--offline'], {
  cwd: projectDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    CARGO_TARGET_DIR: targetDir,
  },
})

const exe = join(targetDir, 'release', 'CetusPrism.exe')
if (!existsSync(exe)) {
  console.error(`build-shell: expected release executable missing at ${exe}`)
  process.exit(1)
}
console.log(`build-shell: ${exe}`)
