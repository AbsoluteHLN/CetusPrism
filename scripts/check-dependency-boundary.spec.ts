import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanDependencyBoundary } from './check-dependency-boundary.ts'

const LINK = 'apps/desktop/.build-cache'

function scan(prepare: (root: string) => void): ReturnType<typeof scanDependencyBoundary> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dependency-boundary-'))
  try {
    prepare(root)
    return scanDependencyBoundary(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('desktop build link', () => {
  it('accepts a repository that holds no build link', () => {
    expect(scan(() => {})).toEqual([])
  })

  it('rejects a real directory that holds the build tree', () => {
    const findings = scan(root => {
      mkdirSync(join(root, 'apps', 'desktop', '.build-cache'), { recursive: true })
    })
    expect(findings.map(finding => finding.kind)).toEqual(['payload'])
    expect(findings[0]?.path.split(/[\\/]/u).join('/')).toBe(LINK)
  })

  it('rejects a link that points outside the shared cache', () => {
    const outside = mkdtempSync(join(tmpdir(), 'dsh-dependency-boundary-target-'))
    try {
      const findings = scan(root => {
        mkdirSync(join(root, 'apps', 'desktop'), { recursive: true })
        symlinkSync(outside, join(root, 'apps', 'desktop', '.build-cache'),
          process.platform === 'win32' ? 'junction' : 'dir')
      })
      expect(findings.map(finding => finding.kind)).toEqual(['link'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('still reports a dependency payload that materialized inside the tree', () => {
    const findings = scan(root => {
      const store = join(root, 'packages', 'core', 'node_modules', '.pnpm', 'pkg@1.0.0')
      mkdirSync(store, { recursive: true })
      writeFileSync(join(store, 'package.json'), '{}\n')
    })
    expect(findings.map(finding => finding.kind)).toEqual(['payload'])
  })
})
