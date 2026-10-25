/**
 * Verify root-relative documentation paths in repo-authored TypeScript. The
 * textual scan covers `docs/*.md` and `.agents/notes/*.md`, requires the
 * extension, checks matching string literals too, and excludes built
 * declarations and vendored source. A path inside an external URL addresses
 * the linked project, so it is not a repository reference.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  findReferenceViolations,
  uniqueRepoFiles,
  type ReferenceMatch,
  type ReferenceViolation as Violation,
} from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/** Repo-authored TypeScript that may cite docs in comments. */
const PATTERNS = ['packages/**/*.ts']

/** Paths excluded from the scan: built output and vendored upstream source. */
const isExcluded = (p: string): boolean =>
  p.includes('/lib/') || p.endsWith('.d.ts') || p.startsWith('vendor/')

/** Root-relative Markdown path token, excluding trailing prose. */
const DOC_REF = /(?:\bdocs|\.agents\/notes)\/[A-Za-z0-9._/-]+\.md/g

/**
 * A URL token on one source line: scheme-qualified (`https://host/path`) or
 * protocol-relative with a dotted host (`//host.tld/path`). The token ends at
 * the first whitespace or quoting character, so a repository-relative path
 * written after the URL stays outside it. A protocol-relative token needs a
 * dotted host, because `//docs/guide.md` is a source comment, not a URL.
 */
const URL_TOKEN = /(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)[^\s'"`<>]*/g

/**
 * Whether a matched reference sits inside an external URL on its line.
 *
 * An upstream protocol document such as `https://host/repo/docs/rpc.md` names
 * a file in the linked project; only a path outside such a URL can address
 * this repository.
 * @param match - where the reference matched.
 * @returns whether the reference addresses another project.
 */
export function isExternalReference(match: ReferenceMatch): boolean {
  for (const token of match.lineText.matchAll(URL_TOKEN)) {
    const start = token.index
    if (match.index >= start && match.index < start + token[0].length) return true
  }
  return false
}

/**
 * Find every broken root-relative documentation reference in one TypeScript file.
 * @param absPath - absolute path of the file to scan.
 * @returns the references that neither resolve in this repository nor address an external URL.
 */
export function findViolations(absPath: string): Violation[] {
  return findReferenceViolations(
    root,
    absPath,
    DOC_REF,
    ref => ref,
    (ref, match) => !existsSync(resolve(root, ref)) && !isExternalReference(match),
  )
}

function main(): void {
  const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
  const all = files.flatMap(file => findViolations(file.abs))
  const checked = files.length

  if (all.length === 0) {
    console.log(`verify-doc-refs: ${checked} file(s) checked, all documentation references resolve.`)
    return
  }

  console.error('verify-doc-refs: broken documentation references found in source comments (target does not exist):')
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}  ${v.ref}`)
  }
  process.exitCode = 1
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
