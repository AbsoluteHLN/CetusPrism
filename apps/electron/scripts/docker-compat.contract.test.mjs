import assert from 'node:assert/strict'
import test from 'node:test'
import { relative, resolve, sep } from 'node:path'
import { invokeDockerContainer } from './docker-compat.mjs'

test('Windows Linux packaging keeps source, artifact, and dependency mounts separate', () => {
  const options = {
    docker: 'docker-fixture',
    image: 'cetusprism/linux-build',
    repoRoot: '/workspace/CetusPrism',
    linuxTarget: '/dependency/cargo/targets/cetusprism-linux',
    cargoRegistry: '/dependency/cargo/registry',
    linuxNode: '/dependency/node/linux-x64',
    containerStore: '/dependency/pnpm/store-container-linux',
    containerVstore: '/dependency/pnpm/virtual',
    outDir: '/workspace/cxbuild/cetusprism/deb-dist',
    containerProxy: 'http://host.docker.internal:7897',
  }
  const calls = []
  const result = invokeDockerContainer('node /repo/apps/electron/scripts/pack-linux.mjs', {
    ...options,
    run: (docker, args) => {
      calls.push({ docker, args })
      return 'captured'
    },
  })

  assert.equal(result, 'captured')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].docker, options.docker)
  const args = calls[0].args
  const mounts = args.flatMap((arg, index) => arg === '-v' ? [args[index + 1]] : [])
  const mountTargets = mounts.map(mount => mount.slice(mount.lastIndexOf(':') + 1))
  assert.deepEqual(mounts, [
    `${options.repoRoot}:/repo`,
    `${options.linuxTarget}:/target`,
    `${options.cargoRegistry}:/usr/local/cargo/registry`,
    `${options.linuxNode}:/node`,
    `${options.containerStore}:/store`,
    `${options.containerVstore}:/vstore`,
    `${options.outDir}:/out`,
  ])
  assert.deepEqual(mountTargets.filter(target => target === '/repo' || target.startsWith(`/repo${sep}`)), ['/repo'])
  assert.equal(mounts.at(-1), `${options.outDir}:/out`)
  assert.equal(relative(resolve(options.repoRoot), resolve(options.outDir)).startsWith(`..${sep}`), true)

  const environment = Object.fromEntries(args.flatMap((arg, index) => {
    if (arg !== '-e') return []
    const assignment = args[index + 1]
    const separator = assignment.indexOf('=')
    return [[assignment.slice(0, separator), assignment.slice(separator + 1)]]
  }))
  assert.deepEqual({
    CARGO_TARGET_DIR: environment.CARGO_TARGET_DIR,
    CETUS_DIST_DIR: environment.CETUS_DIST_DIR,
    CETUS_BUILD_ROOT: environment.CETUS_BUILD_ROOT,
    CETUS_PACK_WORK_ROOT: environment.CETUS_PACK_WORK_ROOT,
    CETUS_NODE_BIN: environment.CETUS_NODE_BIN,
    CETUS_PNPM_STORE: environment.CETUS_PNPM_STORE,
    CETUS_PNPM_VSTORE: environment.CETUS_PNPM_VSTORE,
  }, {
    CARGO_TARGET_DIR: '/target',
    CETUS_DIST_DIR: '/out',
    CETUS_BUILD_ROOT: '/out/build',
    CETUS_PACK_WORK_ROOT: '/out/build/pack-work',
    CETUS_NODE_BIN: '/node/bin/node',
    CETUS_PNPM_STORE: '/store',
    CETUS_PNPM_VSTORE: '/vstore',
  })
  assert.equal(args.at(-1), 'export PATH=/node/bin:$PATH; node /repo/apps/electron/scripts/pack-linux.mjs')
})
