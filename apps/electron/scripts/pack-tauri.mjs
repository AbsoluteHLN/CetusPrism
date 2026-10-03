#!/usr/bin/env node
/**
 * Pack the desktop shell for Windows: assemble `dist/win-unpacked` from the
 * Rust (Tauri/WebView2) shell executable plus the backend runtime closure.
 * The installed layout is:
 *
 *   win-unpacked/CetusPrism.exe                    shell (icon embedded at build)
 *   win-unpacked/resources/app/backend/entry.mjs   backend bootstrap
 *   win-unpacked/resources/app/backend/node.exe    plain Node host
 *   win-unpacked/resources/app/backend/runtime/    pnpm-deployed CLI closure
 *
 * The shell resolves `resources/app/backend` beside its own executable, the
 * same geometry the Electron shell used; the backend bootstrap, the readiness
 * contract, and `DSH_HOME` semantics are unchanged. The backend runtime is a
 * hoisted pnpm deploy — one flat, self-contained `node_modules` with no
 * junctions — verified by heal-deploy-links as the invariant gate, then
 * pruned of non-win32-x64 native prebuilds and the LibreOffice kit, and
 * stripped of declaration files and source maps the shipped plain-Node
 * host never reads.
 *
 * Usage: `node scripts/pack-tauri.mjs` (run `node scripts/build-shell.mjs`
 * and the workspace `build:web` first).
 * @module @deepseek-ai/dsh-electron/pack-tauri
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(appRoot, '..', '..')
const outDir = join(appRoot, 'dist', 'win-unpacked')
const appDir = join(outDir, 'resources', 'app')
// Plain Node for the backend child, from the dependency cache like every
// other runtime input.
const backendNodeExe = process.env.BACKEND_NODE_EXE
  ?? 'E:/dependency-cache/node/node-v24.18.0-win-x64.exe'
// The incremental build cache lives in the dependency cache's cargo folder,
// not in the project tree; CARGO_TARGET_DIR still wins when the caller pins it.
const shellExe = process.env.SHELL_EXE ?? join(
  process.env.CARGO_TARGET_DIR ?? 'E:/dependency-cache/cargo/targets/cetusprism',
  'release',
  'CetusPrism.exe',
)

for (const [label, dir] of [['shell executable', shellExe], ['backend node.exe', backendNodeExe]]) {
  if (!existsSync(dir)) {
    console.error(`pack-tauri: ${label} missing at ${dir}`)
    process.exit(1)
  }
}
for (const file of ['entry.mjs', 'credentials-home.patch.yml', 'desktop-slim.patch.yml', 'desktop-computer-use.patch.yml', 'desktop-experimental.patch.yml']) {
  if (!existsSync(join(appRoot, 'backend', file))) {
    console.error(`pack-tauri: backend/${file} missing — the backend bootstrap is part of the source tree`)
    process.exit(1)
  }
}

try {
  rmSync(outDir, { recursive: true, force: true })
} catch (error) {
  console.error(`pack-tauri: could not clear ${outDir} (${error.message}) — close the running app and retry`)
  process.exit(1)
}
mkdirSync(join(appDir, 'backend'), { recursive: true })

// The shell executable is final at build time: tauri-build embeds the icon
// and version resources, so no rcedit pass runs after packing.
execFileSync('cp', [shellExe, join(outDir, 'CetusPrism.exe')])
// The shipped tree carries the license terms it distributes under.
for (const legal of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  execFileSync('cp', [join(repoRoot, legal), join(appDir, legal)])
}
for (const entry of ['entry.mjs', 'credentials-home.patch.yml', 'desktop-slim.patch.yml', 'desktop-computer-use.patch.yml', 'desktop-experimental.patch.yml']) {
  execFileSync('cp', [join(appRoot, 'backend', entry), join(appDir, 'backend', entry)])
}
// The backend node.exe keeps its cache filename; the packaged name is what
// the shell resolves beside entry.mjs.
execFileSync('cp', [backendNodeExe, join(appDir, 'backend', 'node.exe')])

// Deploy the backend closure straight into the output. The hoisted node
// linker produces one flat, self-contained `node_modules` instead of pnpm's
// junction graph: no junction exists for heal to expand, and the
// profile-fallback BFS resolves every transitive dep textually at the top
// level.
// Invoke the workspace's own pnpm through node: a PATH-resolved standalone
// pnpm self-manages its version and tries to fetch the @pnpm/exe packument,
// which does not exist offline; the local pnpm.cjs runs without that check.
// The virtual store may live in the project (default) or in the shared
// dependency cache (pnpm-workspace.yaml virtualStoreDir).
const pnpmCandidates = [
  join(repoRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
  ...[join(repoRoot, 'node_modules', '.pnpm'), process.env.DSH_PNPM_VSTORE ?? 'E:/dependency-cache/pnpm/vstore']
    .flatMap(vstore => {
      try { return readdirSync(vstore).filter(name => /^pnpm@\d+\./.test(name)).map(name => join(vstore, name, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')) } catch { return [] }
    }),
]
const pnpmCjs = pnpmCandidates.find(candidate => existsSync(candidate))
if (pnpmCjs === undefined) {
  console.error('pack-tauri: local pnpm.cjs not found under node_modules or the virtual store')
  process.exit(1)
}
execFileSync(process.execPath, [
  pnpmCjs,
  '--filter', '@deepseek-ai/dsh', 'deploy', '--prod', '--offline',
  '--node-linker=hoisted', '--config.inject-workspace-packages=true',
  join(appDir, 'backend', 'runtime'),
], { cwd: repoRoot, stdio: 'inherit' })

// The hoisted deploy injects the `link:` workspace packages (vendor
// cosmokit/schemastery, the native landlock stubs) as real copies and leaves
// no junctions; heal still runs as the invariant gate: it embeds anything
// that still points outside the runtime tree and fails the pack if a
// junction survives, because a junction's absolute target dangles once the
// app installs to any other path and the NSIS archiver never finishes
// scanning a cross-referencing junction graph.
execFileSync(process.execPath, [join(appRoot, 'scripts', 'heal-deploy-links.mjs')], { stdio: 'inherit' })

// Prune native prebuilds for platforms this Windows installer cannot run:
// node-pty ships all four platform binaries (~58M per copy) and the NSIS
// artifact only ever installs on win32-x64.
const PRUNE_PREBUILDS = new Set(['win32-x64'])
let prunedPrebuilds = 0
function prunePrebuilds(dir, depth) {
  if (depth > 8) return
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of ents) {
    const path = join(dir, ent.name)
    if (!ent.isDirectory()) continue
    if (ent.name === 'prebuilds') {
      for (const platform of readdirSync(path)) {
        if (!PRUNE_PREBUILDS.has(platform)) {
          rmSync(join(path, platform), { recursive: true, force: true })
          prunedPrebuilds++
        }
      }
      continue
    }
    prunePrebuilds(path, depth + 1)
  }
}
prunePrebuilds(join(appDir, 'backend', 'runtime', 'node_modules'), 0)
if (prunedPrebuilds > 0) console.log(`pack-tauri: pruned ${prunedPrebuilds} non-win32-x64 prebuild platform(s)`)

// Drop the LibreOffice kit: desktop-slim.patch.yml disables the office-to-pdf
// host row, the host service is the kit's only importer, and the kit binaries
// are 330M — a third of the installed size. The document-preview plugin stays
// mounted; only its Office viewer needs the pruned service.
const runtimeNodeModules = join(appDir, 'backend', 'runtime', 'node_modules')
let prunedKits = 0
for (const kit of ['@deepseek-ai/libreoffice-kit', '@deepseek-ai/libreoffice-kit-win32-x64']) {
  if (existsSync(join(runtimeNodeModules, kit))) {
    rmSync(join(runtimeNodeModules, kit), { recursive: true, force: true })
    prunedKits++
  }
}
if (prunedKits > 0) console.log(`pack-tauri: pruned ${prunedKits} libreoffice-kit package(s)`)

// Strip declaration files and source maps from the runtime closure: both are
// build-time artifacts the shipped plain-Node host never reads (it runs
// without --enable-source-maps, so even stack traces never touch the maps).
// LICENSE/NOTICE files stay — they carry the legal attribution.
const STRIP_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts', '.map']
let strippedFiles = 0
let strippedBytes = 0
function stripDeclarations(dir, depth) {
  if (depth > 12) return
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of ents) {
    const path = join(dir, ent.name)
    if (ent.isDirectory()) {
      stripDeclarations(path, depth + 1)
      continue
    }
    if (STRIP_SUFFIXES.some(suffix => ent.name.endsWith(suffix))) {
      strippedBytes += statSync(path).size
      rmSync(path, { force: true })
      strippedFiles++
    }
  }
}
stripDeclarations(runtimeNodeModules, 0)
if (strippedFiles > 0) {
  console.log(`pack-tauri: stripped ${strippedFiles} declaration/source-map file(s) (${(strippedBytes / 1024 / 1024).toFixed(1)}M)`)
}

// CLI shims in `<install>/bin`: the installer's CLI page adds this directory
// to the user PATH when the user opts in, making `dsh` resolvable in cmd,
// PowerShell, and Git Bash. Both shims resolve the backend through %~dp0 /
// $0 relative paths, so they keep working wherever the app is installed.
// ASCII-only content: .cmd files are read in the console codepage.
mkdirSync(join(outDir, 'bin'), { recursive: true })
writeFileSync(
  join(outDir, 'bin', 'dsh.cmd'),
  '@echo off\r\n"%~dp0..\\resources\\app\\backend\\node.exe" "%~dp0..\\resources\\app\\backend\\runtime\\lib\\bin.js" %*\r\n',
)
writeFileSync(
  join(outDir, 'bin', 'dsh'),
  '#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$DIR/../resources/app/backend/node.exe" "$DIR/../resources/app/backend/runtime/lib/bin.js" "$@"\n',
  { mode: 0o755 },
)

console.log(`pack-tauri: packed ${String(countFiles(outDir))} files into ${outDir}`)

/** Recursively count files under `dir` (regular files only). */
function countFiles(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) total += countFiles(path)
    else total += 1
  }
  return total
}
