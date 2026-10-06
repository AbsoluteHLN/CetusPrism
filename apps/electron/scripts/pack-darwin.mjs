#!/usr/bin/env node
/**
 * Assemble the macOS desktop payload and build the .dmg — runs on a macOS
 * host (the GitHub Actions `macos-*` runner) after `pnpm run build` and
 * `cargo build --release` in `src-tauri`. The .app layout mirrors the
 * Windows pack: the shell binary beside a `resources/app/backend` runtime
 * deploy, which `resolve_backend_dir` locates relative to the executable on
 * every platform. The backend Node binary is the runner's own `node`.
 *
 * The bundle is ad-hoc signed (`codesign --sign -`) — required for arm64
 * binaries to execute at all; a distribution build swaps in a real identity.
 *
 * Usage: `node scripts/pack-darwin.mjs`.
 * @module @deepseek-ai/dsh-electron/pack-darwin
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(appRoot, '..', '..')
const outDir = join(appRoot, 'dist')
const appDir = join(outDir, 'macos-unpacked', 'backend')
const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const dmgFile = join(outDir, `CetusPrism-v${version}-macos-arm64.dmg`)

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

console.log('pack-darwin: pnpm deploy (prod) ...')
rmSync(appDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })
run('pnpm', [
  '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
  '--config.inject-workspace-packages=true',
  // The deploy store holds no build side-effects for injected workspace
  // packages, so the default policy refuses their postinstalls; the closure
  // is pinned by the shared lockfile, so allow all builds here.
  '--config.dangerouslyAllowAllBuilds=true',
  appDir,
])
run('node', [join(appRoot, 'scripts', 'heal-deploy-links.mjs'), appDir])

// The backend runtime needs its Node engine beside `entry.mjs`; the runner's
// own node binary is the same major the workspace pins.
cpSync(process.execPath, join(appDir, 'node'))

console.log('pack-darwin: staging CetusPrism.app ...')
const appPath = join(outDir, 'macos-unpacked', 'CetusPrism.app')
const contentsDir = join(appPath, 'Contents')
const macosDir = join(contentsDir, 'MacOS')
mkdirSync(macosDir, { recursive: true })
mkdirSync(join(contentsDir, 'Resources'), { recursive: true })
const shellBinary = process.env.CARGO_TARGET_DIR
  ? join(process.env.CARGO_TARGET_DIR, 'release', 'CetusPrism')
  : join(appRoot, 'src-tauri', 'target', 'release', 'CetusPrism')
cpSync(shellBinary, join(macosDir, 'CetusPrism'))
// The runtime ships under Resources so the bundle signature seals it as
// plain resources; anything under MacOS is treated as code and each file
// would demand a signature.
cpSync(appDir, join(contentsDir, 'Resources', 'app', 'backend'), { recursive: true })
writeFileSync(join(contentsDir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>CetusPrism</string>
  <key>CFBundleDisplayName</key><string>CetusPrism</string>
  <key>CFBundleIdentifier</key><string>com.cetusprism.desktop</string>
  <key>CFBundleExecutable</key><string>CetusPrism</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>com.cetusprism.desktop.dsh</string>
      <key>CFBundleURLSchemes</key>
      <array><string>dsh</string></array>
      <key>CFBundleTypeRole</key><string>Viewer</string>
    </dict>
  </array>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`)

// codesign --deep treats any nested directory that looks like a bundle as one;
// pnpm's `.bin` shim dirs make it abort with "bundle format unrecognized", and
// they are only PATH conveniences the runtime never resolves. Strip them.
function stripBinShims(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.name === '.bin' && ent.isDirectory()) { rmdirSync(full, { recursive: true }); continue }
    if (ent.isDirectory() && !statSync(full).isSymbolicLink()) stripBinShims(full)
  }
}

console.log('pack-darwin: strip pnpm .bin shims ...')
const backendDir = join(appPath, 'Contents', 'Resources', 'app', 'backend')
stripBinShims(join(backendDir, 'node_modules'))

// codesign --deep aborts on any directory it mistakes for a bundle (pnpm's
// `.bin`/`.pnpm` trees), so sign each Mach-O binary individually — arm64
// refuses to execute unsigned code — then seal the bundle itself.
console.log('pack-darwin: ad-hoc codesign (per Mach-O binary) ...')
run('find', [
  backendDir, '-type', 'f', '-exec', 'sh', '-c',
  'file -b "$1" | grep -q Mach-O && codesign --force --sign - "$1"', 'sh', '{}', ';',
])
run('codesign', ['--force', '--sign', '-', appPath])

// LaunchServices must know the staged bundle before the Info.plist's `dsh`
// scheme routes `dsh://open`; the copy the user installs re-registers itself
// on first launch, and this registration covers the staged original.
run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', appPath])

console.log('pack-darwin: hdiutil dmg ...')
rmSync(dmgFile, { force: true })
run('hdiutil', ['create', '-volname', 'CetusPrism', '-srcfolder', join(outDir, 'macos-unpacked', 'CetusPrism.app'), '-format', 'UDZO', dmgFile])
console.log(`pack-darwin: ${dmgFile}`)
