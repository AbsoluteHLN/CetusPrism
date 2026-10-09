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
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(process.env.CETUS_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))
const appRoot = join(repoRoot, 'apps', 'electron')
const targetDir = resolve(process.env.CARGO_TARGET_DIR ?? join('/home/kalcirite/dependency-cache', 'cargo', 'targets', 'cetusprism-linux'))
const nodeBin = resolve(process.env.CETUS_NODE_BIN ?? process.execPath)
// The final .deb lands in the output directory; all staging runs in the
// shared-cache work root so pnpm can freely rename its temporary directories.
const outDir = resolve(process.env.CETUS_DIST_DIR ?? join(appRoot, 'dist'))
const workRoot = resolve(process.env.CETUS_PACK_WORK_ROOT ?? join('/home/kalcirite/dependency-cache', 'cetusprism', 'linux-work'))
const pnpmStore = resolve(process.env.CETUS_PNPM_STORE ?? join('/home/kalcirite/dependency-cache', 'pnpm', 'store'))
const pnpmVstore = resolve(process.env.CETUS_PNPM_VSTORE ?? join('/home/kalcirite/dependency-cache', 'pnpm', 'virtual'))
const unpackedDir = join(workRoot, 'linux-unpacked')
const appDir = join(unpackedDir, 'resources', 'app')
const debStaging = join(workRoot, 'deb-root')
const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const debFile = join(outDir, `CetusPrism-v${version}-amd64.deb`)

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
execFileSync(nodeBin, [join(repoRoot, 'native', 'system', 'scripts', 'build.ts')], { cwd: repoRoot, stdio: 'inherit' })

// Deploy the backend closure straight into the output with the workspace's
// own pnpm. The hoisted linker produces one flat, self-contained
// `node_modules`; unlike the Windows pack this deploy runs ONLINE (proxy
// env), because the store was populated on Windows and the Linux-variant
// optional native packages (bindings, prebuilds) still need fetching.
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
  '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
  '--node-linker=hoisted', '--config.inject-workspace-packages=true',
// The shared store holds no build side-effects for the injected
  // workspace packages, so the default build policy refuses their postinstall
  // (dsh-subprocess-local's spawn-helper chmod) and fails the deploy; the
  // closure is pinned by the shared lockfile, so allow all builds here.
  '--config.dangerouslyAllowAllBuilds=true',
  `--config.store-dir=${pnpmStore}`,
  `--config.virtual-store-dir=${pnpmVstore}`,
  join(appDir, 'backend', 'runtime'),
], { cwd: repoRoot, stdio: 'inherit' })
execFileSync(nodeBin, [join(appRoot, 'scripts', 'heal-deploy-links.mjs'), join(appDir, 'backend', 'runtime')], { stdio: 'inherit' })

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
const runtimeNodeModules = join(appDir, 'backend', 'runtime', 'node_modules')
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
