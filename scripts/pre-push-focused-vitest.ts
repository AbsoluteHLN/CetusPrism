import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { CHECKPOINT_EXEMPT_ENV, checkpointExemptSuites } from './checkpoint-exempt.ts'

/**
 * Pre-push focused vitest gate (lefthook).
 *
 * Runs only the suites owned by the packages touched by the commits being
 * pushed: changed files are mapped to their nearest package root (or run
 * directly when the changed file is itself a spec), and vitest receives those
 * targets with the shared config pinned — a bare vitest run would miss the
 * alias table and jsdom setup and manufacture false reds.
 *
 * Budget: 5 minutes. A timeout downgrades to a warning and never blocks the
 * push (the shared-runner stall class belongs to CI's lane budget); a real
 * suite failure exits non-zero and does block it.
 *
 * Suites whose verdict depends on host-level behaviour are left to CI
 * (membership contract in scripts/checkpoint-exempt.ts): they still run in
 * the ordinary test run, but the bulk checkpoint does not fail on them.
 */

const VITEST_TIMEOUT_MS = 5 * 60 * 1000
const repoRoot = resolve(import.meta.dirname, '..')

function git(args: string, options?: { allowFailure?: boolean }): string | null {
  const result = spawnSync('git', args.split(' '), { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    if (options?.allowFailure) return null
    throw new Error(`git ${args} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim() || null
}

function shaExists(rev: string): boolean {
  return git(`rev-parse --verify --quiet ${rev}`, { allowFailure: true }) !== null
}

/** Files touched by the commits this push would publish. */
function pushedFiles(): string[] | null {
  // Lefthook forwards git's pre-push arguments when available: local sha then remote sha.
  const [localSha, remoteSha] = process.argv.slice(2)
  if (localSha && remoteSha && shaExists(remoteSha) && shaExists(localSha)) {
    return git(`diff --name-only ${remoteSha}..${localSha}`)?.split('\n') ?? []
  }
  // Fall back to the branch's push target; a first push of a new branch has
  // none, and the gate stays silent rather than guessing a range.
  const pushTarget = git('rev-parse --verify --quiet @{push}', { allowFailure: true })
  if (pushTarget !== null) {
    return git(`diff --name-only ${pushTarget}..HEAD`)?.split('\n') ?? []
  }
  return null
}

const specIncludePatterns = [
  /(^|\/)tests\/[^/]+\.spec\.[cm]?tsx?$/,
]

/** Nearest enclosing workspace package root, or null for files outside one. */
function packageRoot(file: string): string | null {
  let directory = resolve(repoRoot, file)
  while (directory.startsWith(repoRoot + sep) && directory !== repoRoot) {
    if (existsSync(resolve(directory, 'package.json'))) return directory
    directory = dirname(directory)
  }
  return null
}

const changed = pushedFiles()
if (changed === null) {
  console.log('pre-push focused vitest: no push range resolved, skipping.')
  process.exit(0)
}

const targets = new Set<string>()
for (const file of changed) {
  if (file === '' || !existsSync(resolve(repoRoot, file))) continue
  // A suite the checkpoint leaves to CI is not a target here either.
  if (checkpointExemptSuites.includes(file.replaceAll('\\', '/'))) continue
  if (specIncludePatterns.some(pattern => pattern.test(file))) {
    // A changed spec runs by itself; its package may be huge and its own
    // failure is exactly the focused signal the gate exists for.
    targets.add(file)
    continue
  }
  const root = packageRoot(file)
  if (root !== null && root !== repoRoot) targets.add(relative(repoRoot, root))
}

if (targets.size === 0) {
  console.log('pre-push focused vitest: no changed package owns tests, skipping.')
  process.exit(0)
}

// The suites assume the host addon exists; rebuild it only when its sources
// moved, so an ordinary package push does not pay the build.
if (changed.some(file => file.startsWith('native/')) || !existsSync(resolve(repoRoot, 'native/system/lib'))) {
  const build = spawnSync('pnpm', ['run', 'build:native-system'], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' })
  if (build.status !== 0) {
    console.error('pre-push focused vitest: native-system build failed.')
    process.exit(build.status ?? 1)
  }
}

const orderedTargets = [...targets].sort()
console.log(`pre-push focused vitest: ${orderedTargets.join(', ')}`)

// shell on Windows: npx resolves to npx.cmd, and Node refuses to spawn .cmd
// shims without a shell.
const child = spawn(
  'npx',
  ['vitest', 'run', '--config', 'configs/vitest.config.ts', '--passWithNoTests', ...orderedTargets],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    signal: AbortSignal.timeout(VITEST_TIMEOUT_MS),
    // The suites whose verdict depends on host-level behaviour stay with CI.
    env: { ...process.env, [CHECKPOINT_EXEMPT_ENV]: '1' },
  },
)

child.on('exit', (code, signal) => {
  if (signal === 'SIGTERM') {
    console.warn(`pre-push focused vitest: exceeded the ${VITEST_TIMEOUT_MS / 1000}s budget; downgrade to warning, push proceeds.`)
    process.exit(0)
  }
  process.exit(code ?? 1)
})
child.on('error', (error: NodeJS.ErrnoException) => {
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
    console.warn(`pre-push focused vitest: exceeded the ${VITEST_TIMEOUT_MS / 1000}s budget; downgrade to warning, push proceeds.`)
    process.exit(0)
  }
  console.error('pre-push focused vitest: failed to launch vitest.', error)
  process.exit(1)
})
