#!/usr/bin/env node
/**
 * Assemble the Linux desktop payload and build the .deb on the native Linux
 * Node runtime. Mirrors `pack-tauri.mjs`: stage `dist/linux-unpacked`
 * (shell binary + backend runtime closure), deploy the workspace package
 * with pnpm's hoisted linker, prune non-Linux payload, then hand-roll the
 * deb with `dpkg-deb` (control + postinst + desktop entry + hicolor icons +
 * `/usr/bin/dsh` shim).
 *
 * The output and all transient staging paths live in the shared dependency
 * cache when invoked by `build-deb.mjs`.
 *
 * @module @deepseek-ai/dsh-electron/pack-linux
 */

import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { resolveCetusBuildRoot } from './build-paths.mjs'

const repoRoot = resolve(process.env.CETUS_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))
const appRoot = join(repoRoot, 'apps', 'electron')
const cetusBuildRoot = resolveCetusBuildRoot(repoRoot)
const dependencyRoot = process.env.CETUS_DEPENDENCY_ROOT ?? join(homedir(), 'dependency-cache')
const targetDir = resolve(process.env.CARGO_TARGET_DIR ?? join(cetusBuildRoot, 'cargo-target'))
const nodeBin = resolve(process.env.CETUS_NODE_BIN ?? process.execPath)
// The final .deb and transient staging paths live under aggregate cxbuild;
// the shared dependency store remains read-only during packaging.
const outDir = resolve(process.env.CETUS_DIST_DIR ?? join(cetusBuildRoot, 'deb-dist'))
const workRoot = resolve(process.env.CETUS_PACK_WORK_ROOT ?? join(cetusBuildRoot, 'pack-work'))
const pnpmStore = resolve(process.env.CETUS_PNPM_STORE ?? join(dependencyRoot, 'pnpm', 'store'))
const pnpmVstore = resolve(process.env.CETUS_PNPM_VSTORE ?? join(dependencyRoot, 'pnpm', 'virtual'))
const unpackedDir = join(workRoot, 'linux-unpacked')
const appDir = join(unpackedDir, 'resources', 'app')
const debStaging = join(workRoot, 'deb-root')
const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const ubuntuTarget = process.env.CETUS_UBUNTU_TARGET ?? ''
const ubuntuGlibcCompiler = process.env.CETUS_GLIBC_CC ?? (ubuntuTarget === '22.04.2' ? process.env.CC : undefined)
const hostGlibc = process.report.getReport().header.glibcVersionRuntime ?? 'unknown (musl)'
const abiTarget = ubuntuTarget === '22.04.2'
  ? 'Ubuntu 22.04.2, maximum required GLIBC symbol version 2.35'
  : `host-native Linux, builder GLIBC ${hostGlibc}; no Ubuntu 22.04 compatibility guarantee`
const debFile = join(outDir, `CetusPrism-v${version}-amd64.deb`)

if (ubuntuTarget !== '' && ubuntuTarget !== '22.04.2') {
  console.error(`pack-linux: unsupported CETUS_UBUNTU_TARGET=${ubuntuTarget}; expected 22.04.2 or unset for host-native`)
  process.exit(1)
}
if (ubuntuTarget === '22.04.2' && !ubuntuGlibcCompiler) {
  console.error('pack-linux: Ubuntu 22.04 target requires CETUS_GLIBC_CC or the sysroot CC wrapper from build-deb.mjs')
  process.exit(1)
}
console.log(`pack-linux: ABI target is ${abiTarget}`)

for (const [label, path] of [['shell binary', join(targetDir, 'release', 'CetusPrism')], ['Linux node', nodeBin]]) {
  if (!existsSync(path)) {
    console.error(`pack-linux: ${label} missing at ${path}`)
    process.exit(1)
  }
}

rmSync(workRoot, { recursive: true, force: true })
mkdirSync(join(appDir, 'backend'), { recursive: true })

// The shell binary is final at build time: tauri-build embeds icon and
// version resources.
execFileSync('cp', [join(targetDir, 'release', 'CetusPrism'), join(unpackedDir, 'CetusPrism')])
execFileSync('chmod', ['0755', join(unpackedDir, 'CetusPrism')])
for (const legal of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  execFileSync('cp', [join(repoRoot, legal), join(appDir, legal)])
}
for (const entry of ['entry.mjs', 'credentials-home.patch.yml', 'desktop-slim.patch.yml', 'desktop-computer-use.patch.yml', 'desktop-experimental.patch.yml']) {
  execFileSync('cp', [join(appRoot, 'backend', entry), join(appDir, 'backend', entry)])
}
execFileSync('cp', [nodeBin, join(appDir, 'backend', 'node')])
execFileSync('chmod', ['0755', join(appDir, 'backend', 'node')])

// The platform native packages are workspace members whose `bin/` binaries
// are compiled at pack time (never committed): the Windows host only builds
// its own addon, so the Linux closure would deploy without
// `node-addon-system-linux-x64/bin/glibc/system.node` and flock would fail
// at first launch. Build them here, where the musl/glibc toolchains live.
console.log('pack-linux: building Linux native prebuilds ...')
const nativeBuildEnv = { ...process.env }
if (ubuntuGlibcCompiler) nativeBuildEnv.CETUS_GLIBC_CC = ubuntuGlibcCompiler
execFileSync(nodeBin, [join(repoRoot, 'native', 'system', 'scripts', 'build.ts')], {
  cwd: repoRoot,
  env: nativeBuildEnv,
  stdio: 'inherit',
})

// Deploy the backend closure straight into the output with the workspace's
// own pnpm. The hoisted linker produces one flat, self-contained
// `node_modules`; the pinned Linux closure must already exist in the shared
// package store. Offline mode prevents package downloads; pnpm 11 may still
// verify lockfile policy against its cached registry metadata.
// pnpm itself comes from the shared virtual store (DSH_PNPM_VSTORE, set by
// build-deb.mjs); the project node_modules is a junction shell with no
// package content to traverse.
const pnpmCandidates = [
  ...[pnpmVstore].flatMap(vstore => {
    try { return readdirSync(vstore).filter(name => /^pnpm@\d+\./.test(name)).map(name => join(vstore, name, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')) } catch { return [] }
  }),
  join(repoRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
]
const pnpmCjs = pnpmCandidates.find(candidate => existsSync(candidate))
if (pnpmCjs === undefined) {
  console.error('pack-linux: local pnpm.cjs not found under the virtual store or node_modules')
  process.exit(1)
}
execFileSync(nodeBin, [
  pnpmCjs,
  '--offline',
  '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
  '--ignore-scripts',
  '--node-linker=hoisted', '--config.inject-workspace-packages=true',
  // Runtime JS outputs and native Linux binaries are staged explicitly below.
  // No dependency lifecycle script is needed for the Linux payload; in
  // particular, dsh-subprocess-local's helper chmod only targets macOS.
  `--config.store-dir=${pnpmStore}`,
  `--config.virtual-store-dir=${pnpmVstore}`,
  join(appDir, 'backend', 'runtime'),
], { cwd: repoRoot, stdio: 'inherit' })
execFileSync(nodeBin, [join(appRoot, 'scripts', 'heal-deploy-links.mjs'), join(appDir, 'backend', 'runtime')], { stdio: 'inherit' })

const runtimeRoot = join(appDir, 'backend', 'runtime')
const runtimeNodeModules = join(runtimeRoot, 'node_modules')

// pnpm deploy copies injected workspace packages from the dependency store.
// Generated files are kept in cxbuild/ by the shared build layout and reached
// from the source tree through symlinks, which deploy omits. Materialize those
// build outputs into the runtime tree before pruning and assembly.
const dshManifest = JSON.parse(readFileSync(join(repoRoot, 'apps', 'cli', 'package.json'), 'utf8'))
function collectWorkspaceManifests(base, found = []) {
  let entries
  try { entries = readdirSync(base, { withFileTypes: true }) } catch { return found }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue
    const dir = join(base, entry.name)
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) found.push(manifest)
    collectWorkspaceManifests(dir, found)
  }
  return found
}
function exportedRuntimeFiles(value, found = []) {
  if (typeof value === 'string') {
    if ((value.startsWith('./lib/') || value.startsWith('./dist/'))
      && !value.endsWith('.d.ts') && !value.includes('*')) found.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) exportedRuntimeFiles(item, found)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'types' && key !== 'typesVersions') exportedRuntimeFiles(item, found)
    }
  }
  return found
}
let materializedOutputs = 0
for (const base of [
  join(repoRoot, 'apps'),
  join(repoRoot, 'packages'),
  join(repoRoot, 'vendor'),
  join(repoRoot, 'native', 'system', 'packages'),
  join(repoRoot, 'python'),
  join(repoRoot, 'benchmarks'),
  join(repoRoot, 'website'),
]) {
  for (const manifestPath of collectWorkspaceManifests(base)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const name = manifest.name
    if (!name || !name.startsWith('@deepseek-ai/')) continue
    const destination = name === dshManifest.name ? runtimeRoot : join(runtimeNodeModules, name)
    if (!existsSync(join(destination, 'package.json'))) continue
    const sourceRoot = dirname(manifestPath)
    const requiredFiles = exportedRuntimeFiles([manifest.main, manifest.module, manifest.bin, manifest.exports])
    for (const outputDir of ['lib', 'dist']) {
      const sourceOutput = join(sourceRoot, outputDir)
      if (!existsSync(sourceOutput)) continue
      const destinationOutput = join(destination, outputDir)
      rmSync(destinationOutput, { recursive: true, force: true })
      cpSync(sourceOutput, destinationOutput, { recursive: true, dereference: true })
      materializedOutputs++
    }
    for (const file of requiredFiles) {
      if (!existsSync(join(destination, file.slice(2)))) {
        console.error(`pack-linux: compiled runtime export missing for ${name}: ${file}`)
        process.exit(1)
      }
    }
  }
}

// The native package is built on the Linux host, but deploy can still select
// its cached injected copy from before the build. Replace the staged payload
// with the binaries just compiled for this package.
const linuxNativePackage = join(runtimeNodeModules, '@deepseek-ai', 'node-addon-system-linux-x64')
const linuxNativeBin = join(repoRoot, 'native', 'system', 'packages', 'linux-x64', 'bin')
for (const required of ['landlock-run', 'glibc/system.node', 'musl/system.node']) {
  if (!existsSync(join(linuxNativeBin, required))) {
    console.error(`pack-linux: required Linux prebuild missing at ${join(linuxNativeBin, required)}`)
    process.exit(1)
  }
}
if (!existsSync(join(linuxNativePackage, 'package.json'))) {
  console.error(`pack-linux: deployed Linux native package missing at ${linuxNativePackage}`)
  process.exit(1)
}
const deployedNativeBin = join(linuxNativePackage, 'bin')
rmSync(deployedNativeBin, { recursive: true, force: true })
cpSync(linuxNativeBin, deployedNativeBin, { recursive: true, dereference: true })

// A cross-target package must not silently pick up a host-built ELF dependency
// with a newer glibc requirement. Inspect the final app shell, bundled Node
// runtime, and every native addon after platform-specific payloads are pruned.
function auditUbuntuGlibcTarget() {
  if (ubuntuTarget !== '22.04.2') return
  const elfCandidates = []
  function isElf(path) {
    let descriptor
    try {
      descriptor = openSync(path, 'r')
      const magic = Buffer.alloc(4)
      return readSync(descriptor, magic, 0, magic.length, 0) === magic.length
        && magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
  function collectElfPayloads(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) collectElfPayloads(path)
      else if (entry.isFile() && isElf(path)) elfCandidates.push(path)
    }
  }
  collectElfPayloads(unpackedDir)
  const tooNew = []
  for (const path of [...new Set(elfCandidates)]) {
    let versions
    try {
      const report = execFileSync(process.env.CETUS_READELF ?? 'readelf', ['--version-info', path], { encoding: 'utf8' })
      versions = [...report.matchAll(/Name: GLIBC_(\d+(?:\.\d+)+)/g)].map(match => match[1].split('.').map(Number))
    } catch (error) {
      console.error(`pack-linux: cannot inspect GLIBC requirements for ${path}: ${error.message}`)
      process.exit(1)
    }
    if (versions.some(parts => parts[0] > 2 || (parts[0] === 2 && parts[1] > 35))) {
      const required = versions.map(parts => parts.join('.')).sort((left, right) => {
        const a = left.split('.').map(Number)
        const b = right.split('.').map(Number)
        return a[0] - b[0] || a[1] - b[1]
      }).at(-1)
      tooNew.push(`${path} requires GLIBC_${required}`)
    }
  }
  if (tooNew.length > 0) {
    console.error(`pack-linux: Ubuntu 22.04 target exceeds its GLIBC_2.35 ceiling:\n${tooNew.join('\n')}`)
    process.exit(1)
  }
  console.log(`pack-linux: checked ${elfCandidates.length} ELF payloads against the GLIBC_2.35 ceiling`)
}

const webFrontend = join(runtimeNodeModules, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
if (!existsSync(webFrontend)) {
  console.error(`pack-linux: web frontend dist/index.html missing at ${webFrontend}`)
  process.exit(1)
}
console.log(`pack-linux: materialized ${materializedOutputs} workspace lib/dist directories and Linux native binaries`)

// Prune native prebuilds for platforms this deb cannot run on.
const KEEP_PREBUILDS = new Set(['linux-x64'])
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
        if (!KEEP_PREBUILDS.has(platform)) {
          rmSync(join(path, platform), { recursive: true, force: true })
          prunedPrebuilds++
        }
      }
      continue
    }
    prunePrebuilds(path, depth)
  }
}
prunePrebuilds(join(appDir, 'backend', 'runtime', 'node_modules'), 0)
if (prunedPrebuilds > 0) console.log(`pack-linux: pruned ${prunedPrebuilds} non-linux-x64 prebuild platform(s)`)

// Drop the LibreOffice kit: desktop-slim.patch.yml disables the office-to-pdf
// host row, the host service is the kit's only importer.
let prunedKits = 0
for (const kit of ['@deepseek-ai/libreoffice-kit', '@deepseek-ai/libreoffice-kit-win32-x64']) {
  if (existsSync(join(runtimeNodeModules, kit))) {
    rmSync(join(runtimeNodeModules, kit), { recursive: true, force: true })
    prunedKits++
  }
}
// Pruned kits leave dangling .bin shims behind; drop the dead links so the
// shipped tree carries no broken symlinks.
const binShimDir = join(runtimeNodeModules, '.bin')
try {
  for (const ent of readdirSync(binShimDir, { withFileTypes: true })) {
    const linkPath = join(binShimDir, ent.name)
    if (ent.isSymbolicLink() && !existsSync(linkPath)) {
      rmSync(linkPath, { force: true })
      prunedKits++
    }
  }
} catch {
  // no .bin directory — nothing to clean
}
if (prunedKits > 0) console.log(`pack-linux: pruned ${prunedKits} libreoffice-kit package(s)`)

auditUbuntuGlibcTarget()

// Strip declaration files and source maps from the runtime closure —
// build-time artifacts the shipped plain-Node host never reads. LICENSE and
// NOTICE files stay.
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
      stripDeclarations(path, depth)
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
  console.log(`pack-linux: stripped ${strippedFiles} declaration/source-map file(s) (${(strippedBytes / 1024 / 1024).toFixed(1)}M)`)
}

// ---- deb assembly ---------------------------------------------------------
// The staging root IS the payload root: dpkg installs everything beside
// DEBIAN/ verbatim, so `opt/` and `usr/` must sit at the top — a nested
// data/ directory would ship the whole tree under /data on the target.
const dataRoot = debStaging
const installDir = join(dataRoot, 'opt', 'CetusPrism')
const debianDir = join(debStaging, 'DEBIAN')
rmSync(debStaging, { recursive: true, force: true })
mkdirSync(installDir, { recursive: true })
mkdirSync(debianDir, { recursive: true })

execFileSync('cp', ['-a', join(unpackedDir, 'CetusPrism'), join(installDir, 'CetusPrism')])
execFileSync('cp', ['-a', join(unpackedDir, 'resources'), installDir])

const packageDocDir = join(dataRoot, 'usr', 'share', 'doc', 'cetusprism')
mkdirSync(packageDocDir, { recursive: true })
writeFileSync(join(packageDocDir, 'build-target'), `${abiTarget}\n`)

// Desktop integration: launcher entry, hicolor icons (generated from the
// product icon at repo development time), and the `dsh` CLI shim.
const desktopEntry = [
  '[Desktop Entry]',
  'Type=Application',
  'Version=1.0',
  'Name=CetusPrism',
  'Comment=DeepSeek Harness desktop distribution — an everything-is-a-plugin AI agent workbench',
  'Exec=/opt/CetusPrism/CetusPrism',
  'Icon=cetusprism',
  'Terminal=false',
  'Categories=Development;Utility;',
  'StartupWMClass=CetusPrism',
  '',
].join('\n')
mkdirSync(join(dataRoot, 'usr', 'share', 'applications'), { recursive: true })
writeFileSync(join(dataRoot, 'usr', 'share', 'applications', 'cetusprism.desktop'), desktopEntry)
for (const size of [32, 64, 128, 256]) {
  const iconDir = join(dataRoot, 'usr', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps')
  mkdirSync(iconDir, { recursive: true })
  cpSync(join(appRoot, 'src-tauri', 'icons', `icon-${size}.png`), join(iconDir, 'cetusprism.png'))
}
const binDir = join(dataRoot, 'usr', 'bin')
mkdirSync(binDir, { recursive: true })
writeFileSync(
  join(binDir, 'dsh'),
  '#!/bin/sh\nexec /opt/CetusPrism/resources/app/backend/node /opt/CetusPrism/resources/app/backend/runtime/lib/bin.js "$@"\n',
)
execFileSync('chmod', ['0755', join(binDir, 'dsh')])

// Installed-Size in KiB, as dpkg expects it. lstat keeps dangling symlinks
// from crashing the walk; the shipped tree should not contain any anyway.
function dirSizeKiB(dir) {
  let total = 0
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name)
    if (ent.isDirectory()) total += dirSizeKiB(path)
    else total += Math.ceil(lstatSync(path).size / 1024)
  }
  return total
}

const control = [
  'Package: cetusprism',
  `Version: ${version}`,
  'Section: utils',
  'Priority: optional',
  'Architecture: amd64',
  'Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1, librsvg2-2, xdg-utils',
  `Installed-Size: ${dirSizeKiB(dataRoot)}`,
  'Maintainer: CetusPrism <cetusprism@localhost>',
  'Description: CetusPrism desktop (DeepSeek Harness distribution)',
  ' An everything-is-a-plugin AI agent workbench: sessions, skills, MCP',
  ' tools, browser and computer use, terminals, and scheduled tasks,',
  ' shipped as a self-contained desktop application.',
  ' .',
  ' Built from the DeepSeek Harness sources; MIT licensed, see',
  ' /opt/CetusPrism/resources/app/LICENSE.',
  '',
].join('\n')
writeFileSync(join(debianDir, 'control'), control)

// The dpkg payload must stay under tracked system paths (/opt, /usr); the
// entry points users touch (menu entry, icons, `dsh` shim) additionally
// mirror into the invoking user's ~/.local so the app opens from their own
// environment. sudo installs carry SUDO_USER; GUI package-kit installs run
// as root and keep only the system copies.
const userHomeProbe = [
  'resolve_user_home() {',
  '  if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then',
  '    getent passwd "$SUDO_USER" | cut -d: -f6',
  '  else',
  '    printf \'%s\\n\' "$HOME"',
  '  fi',
  '}',
]
writeFileSync(
  join(debianDir, 'postinst'),
  [
    '#!/bin/sh',
    'set -e',
    ...userHomeProbe,
    'USER_HOME="$(resolve_user_home)"',
    'if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then USER_HOME=/root; fi',
    'mkdir -p "$USER_HOME/.local/share/applications" "$USER_HOME/.local/bin"',
    'for size in 32 64 128 256; do',
    '  mkdir -p "$USER_HOME/.local/share/icons/hicolor/${size}x${size}/apps"',
    '  cp -f "/usr/share/icons/hicolor/${size}x${size}/apps/cetusprism.png" \\',
    '    "$USER_HOME/.local/share/icons/hicolor/${size}x${size}/apps/cetusprism.png"',
    'done',
    'cp -f /usr/share/applications/cetusprism.desktop "$USER_HOME/.local/share/applications/"',
    'printf \'#!/bin/sh\\nexec /opt/CetusPrism/resources/app/backend/node /opt/CetusPrism/resources/app/backend/runtime/lib/bin.js "$@"\\n\' > "$USER_HOME/.local/bin/dsh"',
    'chmod 0755 "$USER_HOME/.local/bin/dsh"',
    'if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then',
    '  chown -R "$SUDO_USER":"$SUDO_USER" "$USER_HOME/.local/share/applications/cetusprism.desktop" \\',
    '    "$USER_HOME/.local/share/icons/hicolor" "$USER_HOME/.local/bin/dsh"',
    'fi',
    'if command -v update-desktop-database >/dev/null 2>&1; then',
    '  update-desktop-database -q /usr/share/applications || true',
    '  update-desktop-database -q "$USER_HOME/.local/share/applications" || true',
    'fi',
    'exit 0',
    '',
  ].join('\n'),
)
execFileSync('chmod', ['0755', join(debianDir, 'postinst')])
writeFileSync(
  join(debianDir, 'prerm'),
  [
    '#!/bin/sh',
    '# Remove the per-user entry-point mirror; dpkg removes /opt itself.',
    'resolve_user_home() {',
    '  if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then',
    '    getent passwd "$SUDO_USER" | cut -d: -f6',
    '  else',
    '    printf \'%s\\n\' "$HOME"',
    '  fi',
    '}',
    'USER_HOME="$(resolve_user_home)"',
    'if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then USER_HOME=/root; fi',
    'rm -f "$USER_HOME/.local/share/applications/cetusprism.desktop" "$USER_HOME/.local/bin/dsh"',
    'for size in 32 64 128 256; do',
    '  rm -f "$USER_HOME/.local/share/icons/hicolor/${size}x${size}/apps/cetusprism.png"',
    'done',
    'exit 0',
    '',
  ].join('\n'),
)
execFileSync('chmod', ['0755', join(debianDir, 'prerm')])

// dpkg-deb requires the conffiles-free, root-owned tree; --root-owner-group
// keeps the payload owned by root regardless of the building user.
rmSync(debFile, { force: true })
execFileSync('dpkg-deb', ['--build', '--root-owner-group', debStaging, debFile], { stdio: 'inherit' })
console.log(`pack-linux: ${debFile}`)
