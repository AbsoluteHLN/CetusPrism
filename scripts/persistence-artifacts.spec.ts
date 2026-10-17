/** Local persistence history retains bilingual link validation when excluded from Git. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { renderPersistencePair } from './persistence-artifacts.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('resolves existing ignored persistence counterparts and rejects a missing counterpart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persistence-pair-'))
  roots.push(root)
  execFileSync('git', ['init', '--quiet', root])
  await writeFile(join(root, '.gitignore'), 'docs/persistence-changes/\n')
  const history = join(root, 'docs/persistence-changes')
  await mkdir(history, { recursive: true })
  await writeFile(join(history, 'README.md'), '# History\n')
  await writeFile(join(history, 'README.zh.md'), '# 历史\n')
  const source = 'docs/persistence-catalog.md'
  const en = '# Catalog\n\nEnglish | [中文](persistence-catalog.zh.md)\n\n[History](persistence-changes/README.md)\n'
  const zh = '# 目录\n\n[English](persistence-catalog.md) | 中文\n\n[历史](persistence-changes/README.zh.md)\n'
  expect(renderPersistencePair(root, source, en, zh)).toHaveLength(3)
  await rm(join(history, 'README.zh.md'))
  expect(() => renderPersistencePair(root, source, en, zh)).toThrow('bilingual structure mismatch')
})
