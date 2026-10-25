/**
 * Reference classification for `verify-doc-refs`: a repository-relative
 * documentation path must resolve inside this repository, while a path inside
 * an external URL belongs to the linked project and is not checked here.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findViolations } from './verify-doc-refs.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Scan one synthetic TypeScript source and report the references the gate
 * would reject.
 * @param source - the file content to scan.
 * @returns the rejected references with their 1-based line numbers.
 */
function violationsIn(source: string): { line: number; ref: string }[] {
  const root = mkdtempSync(join(tmpdir(), 'doc-refs-'))
  roots.push(root)
  const file = join(root, 'sample.ts')
  writeFileSync(file, source)
  return findViolations(file).map(({ line, ref }) => ({ line, ref }))
}

describe('verify-doc-refs reference classification', () => {
  it('keeps repository-relative references checked', () => {
    expect(violationsIn([
      '/** See docs/missing-reference.md for the local target. */',
      "export const local = 'docs/testing.md'",
    ].join('\n'))).toEqual([{ line: 1, ref: 'docs/missing-reference.md' }])
  })

  it('leaves documentation paths inside an external URL to that project', () => {
    expect(violationsIn([
      "export const upstream = 'https://example.com/project/blob/main/docs/upstream.md'",
      "export const protocol = '//example.com/project/docs/protocol.md'",
    ].join('\n'))).toEqual([])
  })

  it('still checks a repository path written after an external URL', () => {
    expect(violationsIn('// https://example.com/project and docs/after-url.md'))
      .toEqual([{ line: 1, ref: 'docs/after-url.md' }])
  })

  it('checks a source comment that opens with a doubled slash', () => {
    expect(violationsIn('//docs/missing-reference.md'))
      .toEqual([{ line: 1, ref: 'docs/missing-reference.md' }])
  })
})
