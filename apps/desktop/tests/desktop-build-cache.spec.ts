import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARED_BUILD_ROOT,
  desktopBuildLinkPath,
  desktopBuildLinkState,
  sharedDesktopBuildRoot,
} from '../scripts/desktop-build-cache.mjs'

describe('desktop build cache', () => {
  it('keeps the build tree in the shared cache', () => {
    expect(DEFAULT_SHARED_BUILD_ROOT).toBe('E:\\dependency-cache\\cetusprism\\desktop-build')
    expect(sharedDesktopBuildRoot({}, 'win32')).toBe(DEFAULT_SHARED_BUILD_ROOT)
    expect(sharedDesktopBuildRoot({}, 'darwin')).toBe(desktopBuildLinkPath())
  })

  it('accepts an explicit shared cache override', () => {
    const override = join(tmpdir(), 'dsh-build-cache-override')
    expect(sharedDesktopBuildRoot({ DSH_DESKTOP_BUILD_ROOT: override }, 'win32')).toBe(resolve(override))
  })

  it('names the in-tree link that exposes the shared tree', () => {
    expect(desktopBuildLinkPath().endsWith(join('.build-cache'))).toBe(true)
  })

  it('tells a link apart from a real directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-build-cache-state-'))
    const target = mkdtempSync(join(tmpdir(), 'dsh-build-cache-target-'))
    try {
      const directory = join(root, 'directory')
      const link = join(root, 'link')
      mkdirSync(directory)
      symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
      expect(desktopBuildLinkState(join(root, 'missing'))).toBe('missing')
      expect(desktopBuildLinkState(directory)).toBe('directory')
      expect(desktopBuildLinkState(link)).toBe('link')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
    }
  })
})
