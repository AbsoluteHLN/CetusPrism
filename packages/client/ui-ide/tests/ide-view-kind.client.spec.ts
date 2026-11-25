import { describe, expect, it } from 'vitest'
import { ideMimeType, ideViewKind, ideViewUsesTextRead } from '../src/client/ide-view-kind.ts'

describe('IDE view kind routing', () => {
  it('keeps source edits on text-like suffixes', () => {
    expect(ideViewKind('/project/a.ts')).toBe('text')
    expect(ideViewKind('/project/readme.md')).toBe('markdown')
    expect(ideViewKind('/project/page.html')).toBe('html')
    expect(ideViewUsesTextRead('markdown')).toBe(true)
  })

  it('routes binary media through readBytes', () => {
    expect(ideViewKind('/project/logo.png')).toBe('image')
    expect(ideViewKind('/project/manual.pdf')).toBe('pdf')
    expect(ideViewKind('/project/clip.mp4')).toBe('video')
    expect(ideViewUsesTextRead('image')).toBe(false)
    expect(ideMimeType('/project/logo.png')).toBe('image/png')
  })
})