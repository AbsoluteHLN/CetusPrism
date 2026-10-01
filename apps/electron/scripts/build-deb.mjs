#!/usr/bin/env node
/**
 * Build the Linux .deb from Windows via the `cetusprism/linux-build`
 * container: compile the Tauri shell inside the container against the
 * mounted cargo registry cache, then run `pack-linux.mjs` on the Linux Node
 * runtime to stage and assemble the package. The Windows and Linux target
 * trees live side by side in the dependency cache's cargo folder
 * (`cargo/targets/cetusprism` / `cetusprism-linux`).
 *
 * Usage: `node scripts/build-deb.mjs` (requires Docker Desktop running and
 * the `cetusprism/linux-build` image — build it once with
 * `docker build -f docker/linux-build.Dockerfile -t cetusprism/linux-build .`
 * from `apps/electron`).
 *
 * @module @deepseek-ai/dsh-electron/build-deb
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(appRoot, '..', '..')
const image = 'cetusprism/linux-build'

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
const outDir = join(appRoot, 'dist')
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
