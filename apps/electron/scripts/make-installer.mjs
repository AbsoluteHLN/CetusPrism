#!/usr/bin/env node
/**
 * Stamp the desktop shell executable with the product icon and build the
 * Windows NSIS installer from the packed `dist/win-unpacked` tree.
 *
 * Windows derives the window, taskbar, and shortcut icons from the
 * executable's icon resource, so one rcedit pass covers the whole program;
 * the NSIS installer takes its own icon from `build/icon.ico` through
 * electron-builder. rcedit comes from the electron-builder cache inside the
 * dependency boundary — no network, no signing.
 *
 * Usage: `node scripts/make-installer.mjs` (run `pnpm run dist:win` first).
 * @module @deepseek-ai/dsh-electron/make-installer
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const unpackedDir = join(appRoot, 'dist', 'win-unpacked')
const iconPath = join(appRoot, 'build', 'icon.ico')

const builderCache = process.env.ELECTRON_BUILDER_CACHE ?? 'E:/dependency-cache/electron-builder/Cache'
const winCodeSignRoot = join(builderCache, 'winCodeSign')
const rcedit = readdirSync(winCodeSignRoot)
  .map(name => join(winCodeSignRoot, name, 'rcedit-x64.exe'))
  .find(path => existsSync(path))
if (rcedit === undefined) {
  console.error(`make-installer: rcedit-x64.exe not found under ${winCodeSignRoot}`)
  process.exit(1)
}

for (const [label, path] of [
  ['icon', iconPath],
  ['packed executable', join(unpackedDir, existsSync(join(unpackedDir, 'CetusPrism.exe')) ? 'CetusPrism.exe' : 'electron.exe')],
]) {
  if (!existsSync(path)) {
    console.error(`make-installer: ${label} missing at ${path}`)
    process.exit(1)
  }
}

const packedExe = join(unpackedDir, 'CetusPrism.exe')
if (!existsSync(packedExe)) {
  console.log('make-installer: stamping icon onto executable...')
  execFileSync(rcedit, [
    join(unpackedDir, 'electron.exe'),
    '--set-icon', iconPath,
    '--set-version-string', 'ProductName', 'CetusPrism',
    '--set-version-string', 'FileDescription', 'CetusPrism',
  ], { stdio: 'inherit' })
  renameSync(join(unpackedDir, 'electron.exe'), packedExe)
}

console.log('make-installer: building NSIS installer...')
// Invoke the locally installed CLI through node: going through `pnpm exec`
// re-verifies node_modules and has purged devDependencies mid-build.
const builderCli = join(appRoot, 'node_modules', 'electron-builder', 'cli.js')
if (!existsSync(builderCli)) {
  console.error(`make-installer: electron-builder not installed at ${builderCli}`)
  process.exit(1)
}
execFileSync(process.execPath, [
  builderCli, '--win', 'nsis', '--x64', '--prepackaged', 'dist/win-unpacked',
], { cwd: appRoot, stdio: 'inherit' })

console.log(`make-installer: installer ready in ${join(appRoot, 'dist')}`)
