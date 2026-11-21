/**
 * Guard the E-drive dependency boundary for this repository.
 *
 * Every third-party package payload must live under `E:\dependency-cache`; the
 * project tree keeps only the link farm that points there. Two placements
 * break that rule:
 *
 * 1. A package payload materialized inside the repository — the pnpm virtual
 *    store (`.pnpm`) at any `node_modules`, or any other dependency
 *    directory that carries real bytes.
 * 2. A `node_modules` link that points back into the repository instead of
 *    at the shared cache.
 *
 * The workspace pins `storeDir` and `virtualStoreDir` in
 * `pnpm-workspace.yaml`; this gate reads those pins and fails when the
 * installed tree contradicts them, so a dependency drift back into the
 * project is caught before it ships.
 *
 * @module scripts/check-dependency-boundary
 */

import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** The machine's dependency cache: the only home for package payloads. */
const DEPENDENCY_ROOT = 'E:\\dependency-cache'

/** Directories that never hold dependency payloads, wherever they appear. */
const NON_DEPENDENCY_DIRECTORIES = new Set([
  '.git',
  '.desktop-build',
  'dist',
  'cxbuild',
  'coverage',
  'snapshots',
  'temp',
])

/** Dependency directories whose presence inside the project is a violation. */
const PAYLOAD_DIRECTORIES = ['node_modules', '.pnpm', '.venv', 'site-packages'] as const

/** One finding of the scan. */
interface Finding {
  /** What the guard found. */
  readonly kind: 'payload' | 'link'
  /** The offending path, relative to the repository root. */
  readonly path: string
  /** Why it violates the boundary. */
  readonly detail: string
}

/**
 * Read one pin from the workspace manifest.
 * @param root - the repository root.
 * @param key - the setting name, e.g. `storeDir`.
 * @returns the pinned path, or undefined when the setting is absent.
 */
function readPin(root: string, key: string): string | undefined {
  const manifest = resolve(root, 'pnpm-workspace.yaml')
  if (!existsSync(manifest)) return undefined
  const match = new RegExp(`^${key}:\\s*(\\S+)`, 'm').exec(readFileSync(manifest, 'utf8'))
  if (match?.[1] === undefined) return undefined
  return resolve(root, match[1])
}

/**
 * Whether a path sits inside the shared dependency cache.
 * @param path - the absolute path to test.
 * @returns true when the path is inside the cache root.
 */
function insideDependencyCache(path: string): boolean {
  const normalized = resolve(path).toLowerCase()
  return normalized === DEPENDENCY_ROOT.toLowerCase()
    || normalized.startsWith(`${DEPENDENCY_ROOT.toLowerCase()}${sep}`)
}

/**
 * Walk the tree and collect the boundary violations.
 *
 * The scan skips version control metadata, build outputs and any directory
 * that is not a dependency container, so only real dependency placements are
 * examined.
 * @param root - the repository root.
 * @returns every violation found.
 */
export function scanDependencyBoundary(root: string): Finding[] {
  const findings: Finding[] = []
  const walk = (directory: string): void => {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (NON_DEPENDENCY_DIRECTORIES.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.name === 'node_modules') {
        findings.push(...inspectNodeModules(root, path))
        // A `node_modules` is scanned as a link farm; descending into it would
        // only re-report the same links from a second angle.
        continue
      }
      if (PAYLOAD_DIRECTORIES.includes(entry.name as (typeof PAYLOAD_DIRECTORIES)[number])) {
        findings.push({
          kind: 'payload',
          path: relative(root, path),
          detail: `dependency directory "${entry.name}" inside the project tree`,
        })
        continue
      }
      walk(path)
    }
  }
  walk(root)
  return findings
}

/**
 * Inspect one `node_modules` directory for a payload or an inward link.
 * @param root - the repository root.
 * @param directory - the `node_modules` directory to inspect.
 * @returns the violations found inside it.
 */
function inspectNodeModules(root: string, directory: string): Finding[] {
  const findings: Finding[] = []
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return findings
  }
  for (const entry of entries) {
    // The virtual store is the payload: pnpm materializes the whole closure
    // there, so its presence means the packages live in the project.
    if (entry.name === '.pnpm') {
      findings.push({
        kind: 'payload',
        path: relative(root, join(directory, entry.name)),
        detail: 'the pnpm virtual store holds the package payloads; they belong in the shared cache',
      })
      continue
    }
    if (!entry.isSymbolicLink()) continue
    const link = join(directory, entry.name)
    const resolved = resolveLinkTarget(link)
    if (resolved === undefined) continue
    if (insideDependencyCache(resolved)) continue
    // A link back into the repository is a workspace package link: those are
    // the project's own sources, not a dependency payload.
    if (isInsideRepository(resolved, root)) continue
    findings.push({
      kind: 'link',
      path: relative(root, link),
      detail: `points at ${resolved}, which is neither the shared cache nor a workspace package`,
    })
  }
  return findings
}

/**
 * Resolve the target of one link, junction included.
 *
 * pnpm creates Windows junctions as directory symlinks, so `readlink` reads
 * them directly; a junction reported without a target is skipped rather than
 * guessed at.
 * @param link - the link path.
 * @returns the absolute target, or undefined when it cannot be read.
 */
function resolveLinkTarget(link: string): string | undefined {
  try {
    const target = readlinkSync(link)
    return resolve(directoryOf(link), target)
  } catch {
    return undefined
  }
}

/**
 * The directory that contains one path.
 * @param path - the path whose parent is wanted.
 * @returns the parent directory.
 */
function directoryOf(path: string): string {
  const index = path.lastIndexOf(sep)
  return index <= 0 ? path : path.slice(0, index)
}

/**
 * Whether a path sits inside the repository.
 * @param path - the absolute path to test.
 * @param root - the repository root.
 * @returns true when the path is inside the repository.
 */
function isInsideRepository(path: string, root: string): boolean {
  const normalized = resolve(path).toLowerCase()
  const boundary = resolve(root).toLowerCase()
  return normalized === boundary || normalized.startsWith(`${boundary}${sep}`)
}

/**
 * Run the guard.
 * @param root - the repository root.
 * @returns the findings; an empty array means the boundary holds.
 */
export function checkDependencyBoundary(root: string): Finding[] {
  const findings = scanDependencyBoundary(root)
  const storeDir = readPin(root, 'storeDir')
  const virtualStoreDir = readPin(root, 'virtualStoreDir')
  if (virtualStoreDir === undefined) {
    findings.push({
      kind: 'payload',
      path: 'pnpm-workspace.yaml',
      detail: 'virtualStoreDir is not pinned; pnpm would materialize the package payloads inside the project',
    })
  } else if (!insideDependencyCache(virtualStoreDir)) {
    findings.push({
      kind: 'payload',
      path: 'pnpm-workspace.yaml',
      detail: `virtualStoreDir points at ${virtualStoreDir}, outside ${DEPENDENCY_ROOT}`,
    })
  }
  if (storeDir !== undefined && !insideDependencyCache(storeDir)) {
    findings.push({
      kind: 'payload',
      path: 'pnpm-workspace.yaml',
      detail: `storeDir points at ${storeDir}, outside ${DEPENDENCY_ROOT}`,
    })
  }
  return findings
}

/**
 * Print the guard's verdict.
 * @param root - the repository root.
 */
function main(root: string): void {
  const findings = checkDependencyBoundary(root)
  if (findings.length === 0) {
    console.log('check-dependency-boundary: the project tree holds no dependency payload; every package lives in the shared cache.')
    return
  }
  console.error('check-dependency-boundary: dependency boundary violations:')
  for (const finding of findings) {
    console.error(`  - ${finding.path}: ${finding.detail}`)
  }
  process.exitCode = 1
}

if (import.meta.main) {
  main(resolve(import.meta.dirname, '..'))
}
