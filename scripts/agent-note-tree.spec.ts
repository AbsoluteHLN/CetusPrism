import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { walkAgentNoteTree } from './agent-note-tree.ts'

const repoRoot = resolve(import.meta.dirname, '..')

function withGitRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-note-tree-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeFileAt(root: string, path: string, content: string): void {
  const absolutePath = resolve(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function copyFormatGate(root: string): string {
  const scripts = join(root, 'scripts')
  mkdirSync(scripts, { recursive: true })
  writeFileAt(root, 'package.json', '{"type":"module"}\n')
  for (const name of ['agent-note-tree.ts', 'verify-agent-note-format.ts']) {
    writeFileSync(join(scripts, name), readFileSync(join(import.meta.dirname, name)))
  }
  return join(scripts, 'verify-agent-note-format.ts')
}

function runFormatGate(root: string): ReturnType<typeof spawnSync> {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', copyFormatGate(root)], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  expect(result.error).toBeUndefined()
  return result
}

describe('Agent Note tree discovery', () => {
  it('accepts a repository with no Agent Notes', () => {
    withGitRepository(root => {
      expect(walkAgentNoteTree(root)).toEqual({ notes: [], errors: [] })
    })
  })

  it('ignores malformed files excluded by Git', () => {
    withGitRepository(root => {
      writeFileAt(root, '.gitignore', '.agents/notes/\n')
      writeFileAt(root, '.agents/notes/not-a-lifecycle/not-a-note.md', 'malformed')

      expect(walkAgentNoteTree(root)).toEqual({ notes: [], errors: [] })
    })
  })

  it('rejects a force-staged ignored note with an invalid class path', () => {
    withGitRepository(root => {
      const path = '.agents/notes/implemented/not-a-class/not-a-note.md'
      writeFileAt(root, '.gitignore', '.agents/notes/\n')
      writeFileAt(root, path, 'malformed')
      execFileSync('git', ['add', '-f', '--', path], { cwd: root, stdio: 'ignore' })

      expect(walkAgentNoteTree(root).errors.join('\n')).toContain('unknown class folder "not-a-class"')
    })
  })

  it('includes valid tracked notes and nonignored untracked notes', () => {
    withGitRepository(root => {
      const tracked = '.agents/notes/implemented/process/2026-01-02-tracked.md'
      const untracked = '.agents/notes/proposed/feature/2026-01-03-untracked.md'
      writeFileAt(root, tracked, '')
      writeFileAt(root, untracked, '')
      execFileSync('git', ['add', '--', tracked], { cwd: root, stdio: 'ignore' })

      expect(walkAgentNoteTree(root)).toEqual({
        notes: [
          { lifecycle: 'proposed', rel: 'proposed/feature/2026-01-03-untracked.md', date: '2026-01-03' },
          { lifecycle: 'implemented', rel: 'implemented/process/2026-01-02-tracked.md', date: '2026-01-02' },
        ],
        errors: [],
      })
    })
  })

  it('fails the format CLI for a force-staged ignored note with invalid content', () => {
    withGitRepository(root => {
      const path = '.agents/notes/implemented/process/2026-01-02-invalid.md'
      writeFileAt(root, '.gitignore', '.agents/notes/\n')
      writeFileAt(root, path, 'not an Agent Note\n')
      execFileSync('git', ['add', '-f', '--', path], { cwd: root, stdio: 'ignore' })

      const result = runFormatGate(root)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`format: implemented/process/2026-01-02-invalid.md — line 1 must be`)
    })
  })

  it('passes the format CLI for a valid force-staged ignored note', () => {
    withGitRepository(root => {
      const path = '.agents/notes/implemented/process/2026-01-02-valid.md'
      writeFileAt(root, '.gitignore', '.agents/notes/\n')
      writeFileAt(root, path, [
        '# Agent Note: Valid',
        '',
        'Status: implemented',
        '',
        '## Problem',
        '',
        'A problem.',
        '',
        '## Alternatives considered',
        '',
        'No alternative.',
        '',
        '## Decision',
        '',
        'Keep the behavior.',
        '',
        '## Consequences',
        '',
        'The format is checked.',
        '',
      ].join('\n'))
      execFileSync('git', ['add', '-f', '--', path], { cwd: root, stdio: 'ignore' })

      const result = runFormatGate(root)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('1 Agent Note(s) checked')
    })
  })

  it('passes the format CLI when a malformed private note is ignored', () => {
    withGitRepository(root => {
      writeFileAt(root, '.gitignore', '.agents/notes/\n')
      writeFileAt(root, '.agents/notes/implemented/process/2026-01-02-private.md', 'not an Agent Note\n')

      const result = runFormatGate(root)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('0 Agent Note(s) checked')
    })
  })
})
