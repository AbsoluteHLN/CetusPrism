/**
 * Source-build installation: the pipeline runs against a local git fixture,
 * so the clone, build, probe and receipt are exercised without the network.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertUpstreamSource, installExternalRuntimeFromSource,
  type ExternalRuntimeSourceRecipe, type SourceBuildOptions,
} from '../src/source-build.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const root = join(tmpdir(), `dsh-source-build-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`)
  roots.push(root)
  return root
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || String(result.error)}`)
  }
}

/**
 * A local git repository standing in for an upstream: it carries a package.json
 * and one spawnable stdio entry that reports a fixed version.
 */
function fixtureRepo(name: string): string {
  const repo = scratch(name)
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name, private: true }, null, 2)}\n`, 'utf8')
  if (process.platform === 'win32') {
    writeFileSync(join(repo, 'runtime.cmd'), '@echo off\r\necho 9.9.9-source-build\r\n', 'utf8')
  } else {
    writeFileSync(join(repo, 'runtime.sh'), '#!/bin/sh\necho 9.9.9-source-build\n', 'utf8')
    chmodSync(join(repo, 'runtime.sh'), 0o755)
  }
  git(repo, ['init', '--initial-branch', 'main'])
  git(repo, ['add', '.'])
  git(repo, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'fixture runtime'])
  return repo
}

/** Fixture installs pass the test-only source gate and need no network. */
function offline(root: string): SourceBuildOptions {
  return { root, allowUnofficialSource: true }
}

function recipe(repo: string): ExternalRuntimeSourceRecipe {
  return {
    repo,
    install: ['node', '--version'],
    executable: process.platform === 'win32' ? 'runtime.cmd' : 'runtime.sh',
  }
}

describe('assertUpstreamSource', () => {
  it('accepts only the repository the upstream declares', () => {
    expect(() => assertUpstreamSource('pi', 'https://github.com/earendil-works/pi')).not.toThrow()
    expect(() => assertUpstreamSource('pi', 'https://gitlab.com/mirror/pi')).toThrow('builds only from')
  })

  it('rejects an unknown upstream identity', () => {
    expect(() => assertUpstreamSource('opencode' as never, 'https://example.invalid')).toThrow('unknown external runtime')
  })
})

describe('installExternalRuntimeFromSource', () => {
  it('clones, builds, probes and records the receipt', async () => {
    const repo = fixtureRepo('pipeline')
    const root = scratch('install')
    const receipt = await installExternalRuntimeFromSource('pi', recipe(repo), offline(root))
    expect(existsSync(join(root, 'pi', 'package.json'))).toBe(true)
    expect(receipt).toMatchObject({
      id: 'pi',
      repo,
      ref: 'default-branch',
      version: '9.9.9-source-build',
      executable: join(root, 'pi', process.platform === 'win32' ? 'runtime.cmd' : 'runtime.sh'),
    })
    expect(receipt.commit).toMatch(/^[0-9a-f]{40}$/)
    const persisted = JSON.parse(readFileSync(join(root, 'pi', '.cetusprism-source-build.json'), 'utf8'))
    expect(persisted.commit).toBe(receipt.commit)
  })

  it('builds the ref the recipe pins', async () => {
    const repo = fixtureRepo('pinned')
    git(repo, ['checkout', '--quiet', '-b', 'release'])
    const root = scratch('pinned')
    const receipt = await installExternalRuntimeFromSource('pi', { ...recipe(repo), ref: 'release' }, offline(root))
    expect(receipt.ref).toBe('release')
  })

  it('refuses to overwrite an existing install without replace', async () => {
    const repo = fixtureRepo('conflict')
    const root = scratch('conflict')
    await installExternalRuntimeFromSource('pi', recipe(repo), offline(root))
    await expect(installExternalRuntimeFromSource('pi', recipe(repo), offline(root)))
      .rejects.toThrow('already exists')
    const replaced = await installExternalRuntimeFromSource('pi', recipe(repo), { ...offline(root), replace: true })
    expect(replaced.version).toBe('9.9.9-source-build')
  })

  it('fails with the command output when the build breaks', async () => {
    const repo = fixtureRepo('broken')
    const root = scratch('broken')
    await expect(installExternalRuntimeFromSource('pi', {
      ...recipe(repo),
      install: ['node', '-e', 'process.exit(3)'],
    }, offline(root))).rejects.toThrow(/exit code 3/)
  })

  it('refuses a recipe whose built entry never appears', async () => {
    const repo = fixtureRepo('missing-entry')
    const root = scratch('missing-entry')
    await expect(installExternalRuntimeFromSource('pi', {
      ...recipe(repo),
      executable: 'dist/no-such-entry.js',
    }, offline(root))).rejects.toThrow('no entry at')
  })

  it('rejects an unknown upstream identity before anything runs', async () => {
    const root = scratch('unknown')
    await expect(installExternalRuntimeFromSource('opencode' as never, recipe('https://example.invalid'), offline(root)))
      .rejects.toThrow('unknown external runtime')
  })
})
