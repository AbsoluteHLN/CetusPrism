import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function workspaceFixture(options: {
  readonly host: readonly string[]
  readonly client: readonly string[]
}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-project-reference-faces-'))
  roots.push(root)
  const shared = join(root, 'packages/core/shared')
  const split = join(root, 'packages/api/split')
  mkdirSync(shared, { recursive: true })
  mkdirSync(split, { recursive: true })
  const configs = join(root, 'configs')
  mkdirSync(configs, { recursive: true })
  writeJson(join(configs, 'tsconfig.base.json'), {})
  writeJson(join(configs, 'tsconfig.base.client.json'), { extends: './tsconfig.base.json' })
  writeJson(join(shared, 'package.json'), { name: '@deepseek-ai/dsh-shared' })
  writeJson(join(shared, 'tsconfig.json'), {
    extends: '../../../configs/tsconfig.base.json',
    references: [],
  })
  writeJson(join(split, 'package.json'), { name: '@deepseek-ai/dsh-split' })
  writeJson(join(split, 'tsconfig.json'), {
    files: [],
    references: [{ path: './tsconfig.host.json' }, { path: './tsconfig.client.json' }],
  })
  writeJson(join(split, 'tsconfig.host.json'), { references: [{ path: '../../core/shared' }] })
  writeJson(join(split, 'tsconfig.client.json'), { references: [{ path: '../../core/shared' }] })
  writeJson(join(configs, 'tsconfig.host.json'), {
    references: options.host.map(path => ({ path })),
  })
  writeJson(join(configs, 'tsconfig.client.json'), {
    references: options.client.map(path => ({ path })),
  })
  return root
}

describe('Project Reference compiler faces', () => {
  it('allows neutral projects in either graph and matching split leaves', () => {
    const root = workspaceFixture({
      host: ['../packages/core/shared', '../packages/api/split/tsconfig.host.json'],
      client: ['../packages/core/shared', '../packages/api/split/tsconfig.client.json'],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([])
  })

  it('rejects the opposite leaf and the solution root of a split project', () => {
    const root = workspaceFixture({
      host: [
        '../packages/api/split/tsconfig.host.json',
        '../packages/api/split/tsconfig.client.json',
      ],
      client: ['../packages/api/split'],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'configs/tsconfig.client.json: Project Reference "../packages/api/split" enters split project packages/api/split from a Client config; reference "packages/api/split/tsconfig.client.json" instead',
      'configs/tsconfig.host.json: Project Reference "../packages/api/split/tsconfig.client.json" enters split project packages/api/split from a Host config; reference "packages/api/split/tsconfig.host.json" instead',
    ])
  })

  it('uses the referencing project face throughout the reachable graph', () => {
    const root = workspaceFixture({
      host: ['../packages/core/host-consumer'],
      client: ['../packages/core/client-consumer'],
    })
    const hostConsumer = join(root, 'packages/core/host-consumer')
    mkdirSync(hostConsumer, { recursive: true })
    writeJson(join(hostConsumer, 'package.json'), { name: '@deepseek-ai/dsh-host-consumer' })
    writeJson(join(hostConsumer, 'tsconfig.json'), {
      extends: '../../../configs/tsconfig.base.json',
      references: [{ path: '../../api/split/tsconfig.client.json' }],
    })
    const clientConsumer = join(root, 'packages/core/client-consumer')
    mkdirSync(clientConsumer, { recursive: true })
    writeJson(join(clientConsumer, 'package.json'), { name: '@deepseek-ai/dsh-client-consumer' })
    writeJson(join(clientConsumer, 'tsconfig.json'), {
      extends: '../../../configs/tsconfig.base.client.json',
      references: [{ path: '../../api/split/tsconfig.host.json' }],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'packages/core/client-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.host.json" enters split project packages/api/split from a Client config; reference "packages/api/split/tsconfig.client.json" instead',
      'packages/core/host-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.client.json" enters split project packages/api/split from a Host config; reference "packages/api/split/tsconfig.host.json" instead',
    ])
  })

  it('does not inherit a face from the stale root base config path', () => {
    const root = workspaceFixture({ host: ['../packages/core/stale-consumer'], client: [] })
    const staleConsumer = join(root, 'packages/core/stale-consumer')
    mkdirSync(staleConsumer, { recursive: true })
    writeJson(join(root, 'tsconfig.base.json'), {})
    writeJson(join(staleConsumer, 'package.json'), { name: '@deepseek-ai/dsh-stale-consumer' })
    writeJson(join(staleConsumer, 'tsconfig.json'), {
      extends: '../../../tsconfig.base.json',
      references: [{ path: '../../api/split/tsconfig.client.json' }],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'packages/core/stale-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.client.json" enters split project packages/api/split from a config with no Host/Client face',
    ])
  })
})
