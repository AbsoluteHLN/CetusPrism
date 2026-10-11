#!/usr/bin/env node
/**
 * Build the Linux .deb on a native Linux runtime: compile the Tauri shell
 * against the shared cargo registry cache, then run `pack-linux.mjs` to stage
 * and assemble the package. A legacy container path remains available for
 * non-Linux hosts.
 *
 * Usage: `node scripts/build-deb.mjs`. Non-Linux hosts require Docker and
 * the `cetusprism/linux-build` image — build it once with
 * `docker build -f docker/linux-build.Dockerfile -t cetusprism/linux-build .`
 * from `apps/electron`).
 *
 * @module @deepseek-ai/dsh-electron/build-deb
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(appRoot, '..', '..')
const image = 'cetusprism/linux-build'

/** Return directory entries without making toolchain discovery fatal. */
function readdirSyncSafe(path) {
  try { return readdirSync(path) } catch { return [] }
}

/** Build and package directly with the host Linux toolchain. */
function buildNativeLinux() {
  const cargoHome = process.env.CARGO_HOME ?? '/home/kalcirite/dependency-cache/cargo'
  const rustupHome = process.env.RUSTUP_HOME ?? '/home/kalcirite/dependency-cache/rustup'
  const sysroot = process.env.LINUX_SYSROOT ?? '/home/kalcirite/dependency-cache/sysroot/ubuntu-22.04.2'
  const nativeTools = process.env.NATIVE_LINUX_TOOLCHAIN ?? '/home/kalcirite/dependency-cache/tooling/native-linux/bin'
  const targetDir = process.env.CARGO_TARGET_DIR
    ?? join(cargoHome, 'targets', 'cetusprism-linux')
  const outDir = process.env.CETUS_DIST_DIR ?? join(appRoot, 'dist')
  const workDir = process.env.CETUS_PACK_WORK
    ?? join(dirname(cargoHome), 'cetusprism', 'linux-work-native')
  const cargoCandidates = [
    process.env.CARGO,
    ...(process.env.PATH ?? '').split(':').filter(Boolean).map(path => join(path, 'cargo')),
    ...readdirSyncSafe(join(rustupHome, 'toolchains'))
      .map(name => join(rustupHome, 'toolchains', name, 'bin', 'cargo')),
  ].filter((candidate) => candidate !== undefined)
  const cargo = cargoCandidates.find(candidate => existsSync(candidate))
  if (cargo === undefined) {
    console.error(`build-deb: native Linux cargo missing under ${join(rustupHome, 'toolchains')}`)
    process.exit(1)
  }
  mkdirSync(targetDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })
  const buildEnvironment = {
    ...process.env,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    CARGO_TARGET_DIR: targetDir,
    PATH: `${nativeTools}:${dirname(cargo)}:${process.env.PATH ?? ''}`,
    PKG_CONFIG_PATH: [
      join(sysroot, 'usr', 'lib', 'x86_64-linux-gnu', 'pkgconfig'),
      join(sysroot, 'usr', 'share', 'pkgconfig'),
    ].join(':'),
    PKG_CONFIG_LIBDIR: [
      join(sysroot, 'usr', 'lib', 'x86_64-linux-gnu', 'pkgconfig'),
      join(sysroot, 'usr', 'share', 'pkgconfig'),
    ].join(':'),
    PKG_CONFIG_SYSROOT_DIR: sysroot,
  }
  console.log(`build-deb: cargo build --release --offline (native Linux, ${cargo}) ...`)
  execFileSync(cargo, ['build', '--release', '--offline'], {
    cwd: join(appRoot, 'src-tauri'),
    env: buildEnvironment,
    stdio: 'inherit',
  })
  console.log('build-deb: staging and assembling the deb (native Linux) ...')
  execFileSync(process.execPath, [join(appRoot, 'scripts', 'pack-linux.mjs')], {
    cwd: repoRoot,
    env: {
      ...buildEnvironment,
      CETUS_PACK_REPO: repoRoot,
      CETUS_PACK_TARGET: targetDir,
      CETUS_PACK_NODE: process.env.LINUX_NODE ?? process.execPath,
      CETUS_PACK_OUT: outDir,
      CETUS_PACK_WORK: workDir,
      DSH_PACK_STORE: process.env.PNPM_STORE_DIR ?? join(dirname(cargoHome), 'pnpm', 'store'),
      DSH_PACK_OFFLINE: '1',
    },
    stdio: 'inherit',
  })
}

if (process.platform === 'linux' && process.env.CETUS_NATIVE_LINUX !== '0') {
  buildNativeLinux()
  process.exit(0)
}

const docker = process.env.DOCKER ?? 'docker'
try {
  execFileSync(docker, ['image', 'inspect', image], { stdio: 'pipe' })
} catch {
  console.error(`build-deb: image ${image} missing — build it once from apps/electron with:\n` +
    `  docker build -f docker/linux-build.Dockerfile -t ${image} .`)
  process.exit(1)
}

const cargoRegistry = process.env.CARGO_HOME ?? 'E:/dependency-cache/cargo'
const linuxTarget = join(dirname(cargoRegistry), 'targets', 'cetusprism-linux')
const linuxNode = process.env.LINUX_NODE_HOME ?? 'E:/dependency-cache/node/node-v24.18.0-linux-x64'
// Container-side pnpm store: the workspace yaml pins a Windows storeDir the
// container cannot use, so the deploy store is pinned by mount + flag
// instead and persists across builds in the dependency cache.
const containerStore = join(dirname(cargoRegistry), 'pnpm', 'store-container-linux')
// The virtual store holds the workspace's pnpm package; the project
// node_modules is a junction shell with no real content to mount.
const containerVstore = process.env.DSH_PNPM_VSTORE ?? 'E:/dependency-cache/pnpm/vstore'
// The .deb output joins the other build artifacts in the dependency cache on
// Windows (matching pack-tauri); other hosts keep the in-tree dist.
const outDir = process.env.CETUS_DIST_DIR
  ?? (process.platform === 'win32' ? 'E:/dependency-cache/cetusprism/dist' : join(appRoot, 'dist'))
mkdirSync(linuxTarget, { recursive: true })
mkdirSync(containerStore, { recursive: true })
mkdirSync(outDir, { recursive: true })

if (!existsSync(join(linuxNode, 'bin', 'node'))) {
  console.error(`build-deb: Linux Node runtime missing at ${linuxNode}`)
  process.exit(1)
}

// Host proxy forwarded into the container: only the runtime deploy needs the
// network (Linux-variant optional native packages), the cargo build is
// offline from the mounted registry cache.
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? 'http://127.0.0.1:7897'
const containerProxy = proxy.replace('127.0.0.1', 'host.docker.internal')

function runInContainer(command) {
  // /node/bin joins the image PATH (not replaces it): pnpm deploy runs
  // dependency install scripts that shell out to `node`, while cargo must
  // stay reachable at /usr/local/cargo/bin.
  execFileSync(docker, [
    'run', '--rm',
    '-v', `${repoRoot}:/repo`,
    '-v', `${linuxTarget}:/target`,
    '-v', `${cargoRegistry}/registry:/usr/local/cargo/registry`,
    '-v', `${linuxNode}:/node`,
    '-v', `${containerStore}:/store`,
    '-v', `${containerVstore}:/vstore`,
    '-v', `${outDir}:/out`,
    '-e', `CARGO_TARGET_DIR=/target`,
    '-e', `HTTP_PROXY=${containerProxy}`,
    '-e', `HTTPS_PROXY=${containerProxy}`,
    '-e', 'NO_PROXY=localhost,127.0.0.1,host.docker.internal',
    '-w', '/repo',
    image,
    'bash', '-c', `export PATH=/node/bin:$PATH; ${command}`,
  ], { stdio: 'inherit' })
}

console.log('build-deb: cargo build --release --offline (container, linux) ...')
runInContainer('cd /repo/apps/electron/src-tauri && cargo build --release --offline')
console.log('build-deb: staging and assembling the deb ...')
runInContainer('/node/bin/node /repo/apps/electron/scripts/pack-linux.mjs')
