import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finalizeCetusDistInstaller } from './cetus-dist-finish.mjs'
import { cetusInstallerName } from './cetus-win-paths.mjs'

describe('cetus dist finish', () => {
  it('keeps only the current installer at the dist root', () => {
    const dist = mkdtempSync(join(tmpdir(), 'cetus-dist-finish-'))
    const version = '2.0.2-prelease-2026-11-24-A'
    const keep = cetusInstallerName(version)
    try {
      writeFileSync(join(dist, keep), 'installer')
      writeFileSync(join(dist, 'deepseek-harness-old-win-x64-unsigned.exe'), 'stale')
      mkdirSync(join(dist, 'win-unpacked'), { recursive: true })
      const path = finalizeCetusDistInstaller({ distDir: dist, version })
      expect(path).toBe(join(dist, keep))
      expect(readdirNames(dist)).toEqual([keep])
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})

/** @param {string} dist */
function readdirNames(dist) {
  return readdirSync(dist).sort()
}