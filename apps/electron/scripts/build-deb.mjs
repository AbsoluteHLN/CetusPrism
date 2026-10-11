#!/usr/bin/env node
/**
 * Build the Linux desktop distribution.
 *
 * Linux hosts use the native Rust toolchain and native workspace paths. The
 * Windows compatibility path remains available for the existing release
 * workflow, but Linux builds never require Docker.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(appRoot, '..', '..')
const dependencyRoot = process.env.CETUS_DEPENDENCY_ROOT ?? join(homedir(), 'dependency-cache')

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

const cargoHome = process.env.CARGO_HOME ?? join(dependencyRoot, 'cargo')
const rustupHome = process.env.RUSTUP_HOME ?? join(dependencyRoot, 'rustup')
const targetDir = process.env.CARGO_TARGET_DIR ?? join(cargoHome, 'targets', 'cetusprism-linux')
const outDir = process.env.CETUS_DIST_DIR ?? join(appRoot, 'dist')
const nativeSysroot = process.env.CETUS_NATIVE_SYSROOT ?? join(dependencyRoot, 'sysroot', 'native-linux')
const ubuntuTarget = process.env.CETUS_UBUNTU_TARGET ?? ''
const ubuntuSysroot = resolve(process.env.CETUS_UBUNTU_SYSROOT ?? join(dependencyRoot, 'sysroot', 'ubuntu-22.04.2'))

function prepareUbuntuTargetTools() {
  if (ubuntuTarget !== '22.04.2') return { path: process.env.PATH ?? '', env: {} }
  const gcc = join(ubuntuSysroot, 'usr', 'bin', 'gcc-11')
  const gxx = join(ubuntuSysroot, 'usr', 'bin', 'g++-11')
  if (!existsSync(gcc) || !existsSync(gxx)) {
    console.error(`build-deb: Ubuntu ${ubuntuTarget} compiler sysroot is incomplete at ${ubuntuSysroot}`)
    process.exit(1)
  }
  const tools = join(dependencyRoot, 'tooling', `ubuntu-${ubuntuTarget}`, 'bin')
  mkdirSync(tools, { recursive: true })
  const gccLib = join(ubuntuSysroot, 'usr', 'lib', 'gcc', 'x86_64-linux-gnu', '11')
  const multiarchLib = join(ubuntuSysroot, 'usr', 'lib', 'x86_64-linux-gnu')
  const wrapper = (compiler) => `#!/bin/sh\nexec "${compiler}" --sysroot="${ubuntuSysroot}" -B"${gccLib}/" -B"${multiarchLib}/" -Wl,--allow-shlib-undefined "$@"\n`
  for (const [name, compiler] of [['gcc', gcc], ['cc', gcc], ['g++', gxx], ['c++', gxx]]) {
    const path = join(tools, name)
    writeFileSync(path, wrapper(compiler))
    chmodSync(path, 0o755)
  }
  const targetEnv = {
    CC: join(tools, 'cc'),
    CXX: join(tools, 'c++'),
    AR: join(ubuntuSysroot, 'usr', 'bin', 'ar'),
    RANLIB: join(ubuntuSysroot, 'usr', 'bin', 'ranlib'),
    STRIP: join(ubuntuSysroot, 'usr', 'bin', 'strip'),
    PKG_CONFIG_ALLOW_CROSS: '1',
    PKG_CONFIG_SYSROOT_DIR: ubuntuSysroot,
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER: join(tools, 'cc'),
  }
  console.log(`build-deb: targeting Ubuntu ${ubuntuTarget} with sysroot ${ubuntuSysroot}`)
  return { path: `${tools}:${process.env.PATH ?? ''}`, env: targetEnv }
}

function prepareNativeTools() {
  const specs = join(nativeSysroot, 'usr', 'lib', 'x86_64-linux-musl', 'musl-gcc.specs')
  if (!existsSync(specs)) return process.env.PATH
  const tools = join(dependencyRoot, 'tooling', 'native-linux', 'bin')
  mkdirSync(tools, { recursive: true })
  const localSpecs = join(tools, 'musl-gcc.specs')
  writeFileSync(localSpecs, readFileSync(specs, 'utf8').replaceAll('/usr/include/x86_64-linux-musl', join(nativeSysroot, 'usr', 'include', 'x86_64-linux-musl')).replaceAll('/usr/lib/x86_64-linux-musl', join(nativeSysroot, 'usr', 'lib', 'x86_64-linux-musl')))
  const compiler = join(tools, 'musl-gcc')
  const hostCompiler = process.env.CETUS_HOST_GCC ?? '/usr/bin/gcc'
  writeFileSync(compiler, `#!/bin/sh\nexec "${hostCompiler}" "$@" -specs "${localSpecs}"\n`)
  chmodSync(compiler, 0o755)
  return `${tools}:${process.env.PATH ?? ''}`
}
mkdirSync(targetDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

if (process.platform === 'linux') {
  const ubuntuTools = prepareUbuntuTargetTools()
  const nativeToolsPath = prepareNativeTools()
  const toolchainRoots = []
  const toolchainsDir = join(rustupHome, 'toolchains')
  if (existsSync(toolchainsDir)) {
    for (const name of readdirSync(toolchainsDir).sort()) toolchainRoots.push(join(toolchainsDir, name, 'bin'))
  }
  const buildPath = [ubuntuTools.path, nativeToolsPath, ...toolchainRoots].filter(Boolean).join(':')
  const cargoCandidates = [
    process.env.CARGO_BIN,
    ...toolchainRoots.map((root) => join(root, 'cargo')),
    join(cargoHome, 'bin', 'cargo'),
    'cargo',
  ].filter(Boolean)
  const cargo = cargoCandidates.find((candidate) => existsSync(candidate) || candidate === 'cargo')
  if (!cargo || !existsSync(cargo) && cargo !== 'cargo') {
    console.error(`build-deb: cargo is required on Linux; install it in ${rustupHome} or set CARGO_BIN`)
    process.exit(1)
  }

  const webDist = resolve(process.env.CETUS_WEB_DIST ?? join(repoRoot, 'apps', 'web', 'dist'))
  if (!existsSync(join(webDist, 'index.html')) && process.env.CETUS_BUILD_WEB === 'true') {
    run('corepack', ['pnpm@11.7.0', 'run', 'build:web'], {
      cwd: repoRoot,
      env: { ...process.env, CI: process.env.CI ?? 'true' },
    })
  }
  if (!existsSync(join(webDist, 'index.html'))) {
    console.error(`build-deb: web payload missing at ${webDist}; run 'pnpm run build:web' first`)
    process.exit(1)
  }
  const frontendDist = join(appRoot, 'src-tauri', 'frontend')
  const frontendBackup = join(dependencyRoot, 'cetusprism', 'frontend-placeholder')
  rmSync(frontendBackup, { recursive: true, force: true })
  cpSync(frontendDist, frontendBackup, { recursive: true })
  cpSync(webDist, frontendDist, { recursive: true, force: true })

  const cargoFlags = process.env.CETUS_CARGO_OFFLINE === 'true' ? ['--offline'] : []
  console.log(`build-deb: cargo build --release${cargoFlags.length > 0 ? ' --offline' : ''} (native Linux, target ${targetDir}) ...`)
  try {
    run(cargo, ['build', '--release', ...cargoFlags], {
      cwd: join(appRoot, 'src-tauri'),
      env: {
        ...process.env,
        ...ubuntuTools.env,
        CARGO_HOME: cargoHome,
        RUSTUP_HOME: rustupHome,
        CARGO_TARGET_DIR: targetDir,
        PKG_CONFIG_PATH: [
          join(ubuntuTarget === '22.04.2' ? ubuntuSysroot : nativeSysroot, 'usr', 'lib', 'x86_64-linux-gnu', 'pkgconfig'),
          join(ubuntuTarget === '22.04.2' ? ubuntuSysroot : nativeSysroot, 'usr', 'share', 'pkgconfig'),
          process.env.PKG_CONFIG_PATH,
        ].filter(Boolean).join(':'),
        RUSTFLAGS: [
          process.env.RUSTFLAGS,
          `-L${join(ubuntuTarget === '22.04.2' ? ubuntuSysroot : nativeSysroot, 'usr', 'lib', 'x86_64-linux-gnu')}`,
        ].filter(Boolean).join(' '),
        PATH: buildPath,
      },
    })
  } finally {
    rmSync(frontendDist, { recursive: true, force: true })
    cpSync(frontendBackup, frontendDist, { recursive: true })
  }
  run(process.execPath, [join(appRoot, 'scripts', 'pack-linux.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...ubuntuTools.env,
      CARGO_TARGET_DIR: targetDir,
      CETUS_DIST_DIR: outDir,
      CETUS_REPO_ROOT: repoRoot,
      CETUS_NODE_BIN: process.env.CETUS_NODE_BIN ?? process.execPath,
      CETUS_PNPM_STORE: process.env.CETUS_PNPM_STORE ?? join(dependencyRoot, 'pnpm', 'store'),
      CETUS_PNPM_VSTORE: process.env.CETUS_PNPM_VSTORE ?? join(dependencyRoot, 'pnpm', 'virtual'),
      CETUS_PACK_WORK_ROOT: process.env.CETUS_PACK_WORK_ROOT ?? join(dependencyRoot, 'cetusprism', 'linux-work'),
      PATH: buildPath,
    },
  })
  process.exit(0)
}

// Windows compatibility route. This is isolated from the native Linux path
// and retains the established Docker build contract.
const image = 'cetusprism/linux-build'
const docker = process.env.DOCKER ?? 'docker'
try {
  execFileSync(docker, ['image', 'inspect', image], { stdio: 'pipe' })
} catch {
  console.error(`build-deb: image ${image} missing — build it once from apps/electron with:\n` +
    `  docker build -f docker/linux-build.Dockerfile -t ${image} .`)
  process.exit(1)
}

const linuxTarget = join(dirname(cargoHome), 'targets', 'cetusprism-linux')
const linuxNode = process.env.LINUX_NODE_HOME ?? 'E:/dependency-cache/node/node-v24.18.0-linux-x64'
const containerStore = join(dirname(cargoHome), 'pnpm', 'store-container-linux')
const containerVstore = process.env.DSH_PNPM_VSTORE ?? 'E:/dependency-cache/pnpm/vstore'
mkdirSync(linuxTarget, { recursive: true })
mkdirSync(containerStore, { recursive: true })
if (!existsSync(join(linuxNode, 'bin', 'node'))) {
  console.error(`build-deb: Linux Node runtime missing at ${linuxNode}`)
  process.exit(1)
}
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? 'http://127.0.0.1:7897'
const containerProxy = proxy.replace('127.0.0.1', 'host.docker.internal')
function runInContainer(command) {
  run(docker, [
    'run', '--rm', '-v', `${repoRoot}:/repo`, '-v', `${linuxTarget}:/target`,
    '-v', `${cargoHome}/registry:/usr/local/cargo/registry`, '-v', `${linuxNode}:/node`,
    '-v', `${containerStore}:/store`, '-v', `${containerVstore}:/vstore`, '-v', `${outDir}:/out`,
    '-e', 'CARGO_TARGET_DIR=/target', '-e', `HTTP_PROXY=${containerProxy}`,
    '-e', `HTTPS_PROXY=${containerProxy}`, '-e', 'NO_PROXY=localhost,127.0.0.1,host.docker.internal',
    '-w', '/repo', image, 'bash', '-c', `export PATH=/node/bin:$PATH; ${command}`,
  ])
}
console.log('build-deb: cargo build --release --offline (container, linux) ...')
runInContainer('cd /repo/apps/electron/src-tauri && cargo build --release --offline')
console.log('build-deb: staging and assembling the deb ...')
runInContainer('/node/bin/node /repo/apps/electron/scripts/pack-linux.mjs')
