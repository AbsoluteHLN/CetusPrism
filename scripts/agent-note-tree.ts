/**
 * Shared structural source of truth for the Agent Note tree. Lifecycle and class
 * sets are closed under `.agents/notes/README.md`; importing this module is pure.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const agentNoteRoot = resolve(import.meta.dirname, '../.agents/notes')

/** The closed set of active Agent Note lifecycles (top-level folders under .agents/notes/). */
const AGENT_NOTE_LIFECYCLES = ['proposed', 'implemented', 'rejected'] as const

/**
 * The closed set of Agent Note classes (nested folder under each lifecycle). Adding a
 * class is a deliberate act: extend this list AND the README's Classification
 * section. The gate rejects any folder not listed here.
 */
export const AGENT_NOTE_CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'] as const

/** Historical implemented notes live outside the active lifecycle tree. */
const AGENT_NOTE_ARCHIVE = 'archived'
const AGENT_NOTE_PATH = '.agents/notes/'

/** Non-Agent Note Markdown allowed to sit directly at a lifecycle root. */
const ROOT_ALLOWLIST = new Set(['AGENTS.md', 'CLAUDE.md'])

/** One Agent Note file, as discovered by the walker. */
export interface AgentNote {
  lifecycle: string
  /** Path relative to .agents/notes. */
  rel: string
  /** `yyyy-mm-dd` from the filename. */
  date: string
}

/**
 * Walk Git-maintained Agent Note paths, enforcing the structure rules. Returns every
 * valid Agent Note plus one error string per violation (unknown lifecycle or class
 * folder, bad depth, or bad filename). Callers treat a non-empty error list as fatal.
 * @param repoRoot Absolute Git repository root used to enumerate maintained paths.
 * @returns Discovered Agent Notes and structural violations.
 */
export function walkAgentNoteTree(repoRoot = resolve(import.meta.dirname, '..')): { notes: AgentNote[]; errors: string[] } {
  const notes: AgentNote[] = []
  const errors: string[] = []
  const maintainedPaths = execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z', '--', '.agents/notes',
  ], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter(path => existsSync(resolve(repoRoot, path)))
  const notePaths = maintainedPaths
    .filter(path => path.startsWith(AGENT_NOTE_PATH))
    .map(path => path.slice(AGENT_NOTE_PATH.length))

  // The lifecycle set is closed too: any directory under .agents/notes/ that is not
  // a known lifecycle would otherwise hold Agent Notes invisible to the walk below.
  const directories = new Set(notePaths.filter(path => path.includes('/')).map(path => path.split('/')[0] ?? ''))
  if (notePaths.some(path => path === 'INDEX.md') || directories.has('INDEX.md')) {
    errors.push('structure: INDEX.md — centralized Agent Note indexes are forbidden; browse the lifecycle/class tree or search the repository')
  }
  for (const directory of directories) {
    if (directory !== AGENT_NOTE_ARCHIVE
      && directory !== 'INDEX.md'
      && !(AGENT_NOTE_LIFECYCLES as readonly string[]).includes(directory)) {
      errors.push(`structure: ${directory}/ — unknown lifecycle folder (allowed: ${AGENT_NOTE_LIFECYCLES.join(', ')}, plus ${AGENT_NOTE_ARCHIVE}/)`)
    }
  }
  for (const lifecycle of AGENT_NOTE_LIFECYCLES) {
    for (const match of notePaths.filter(path => path.startsWith(`${lifecycle}/`) && path.endsWith('.md')).sort()) {
      const segs = match.split('/')
      // Allowlisted file directly at the lifecycle root (e.g. implemented/AGENTS.md).
      if (segs.length === 2 && ROOT_ALLOWLIST.has(segs[1] ?? '')) continue
      // A Chinese counterpart (foo.zh.md, docs/i18n/README.md) is the SAME Agent Note,
      // indexed via its English filename; the pairing gate owns its consistency.
      if (match.endsWith('.zh.md')) continue
      const cls = segs[1]
      const base = segs[2]
      if (segs.length !== 3 || cls === undefined || base === undefined) {
        errors.push(`structure: ${match} — expected {lifecycle}/{class}/file.md (got depth ${segs.length})`)
        continue
      }
      if (!(AGENT_NOTE_CLASSES as readonly string[]).includes(cls)) {
        errors.push(`structure: ${match} — unknown class folder "${cls}" (allowed: ${AGENT_NOTE_CLASSES.join(', ')})`)
        continue
      }
      if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(base)) {
        errors.push(`structure: ${match} — filename must be yyyy-mm-dd-topic.md`)
        continue
      }
      notes.push({ lifecycle, rel: match, date: base.slice(0, 10) })
    }
  }
  return { notes, errors }
}
