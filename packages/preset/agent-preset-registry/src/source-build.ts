/** Source-build installation of an external runtime: clone, build, probe, receipt. */

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { EXTERNAL_RUNTIME_UPSTREAMS, locateExternalRuntime, type ExternalRuntimeId, type ExternalRuntimeProbe } from './external-runtime.ts'

const exec = promisify(execFile)

/** How one upstream is built from its own repository source. */
export interface ExternalRuntimeSourceRecipe {
  /**
   * The repository to clone.
   *
   * The production entry point validates this against the upstream record
   * before calling — a source build must come from the repository the
   * upstream declares, never from a mirror the caller was handed.
   */
  readonly repo: string
  /**
   * The tag or branch to build, pinned before anything runs. Absent builds
   * the upstream's default branch; the resolved commit lands in the receipt
   * either way, so what was built stays on record.
   */
  readonly ref?: string
  /** Dependency installation command, run inside the clone. */
  readonly install: readonly string[]
  /** Optional build command, run after the install. */
  readonly build?: readonly string[]
  /** The stdio CLI entry, relative to the clone root, spawnable as-is. */
  readonly executable: string
}

/** What one finished source build left on disk. */
export interface SourceBuildReceipt {
  /** The upstream identity that was built. */
  readonly id: ExternalRuntimeId
  /** The repository the clone came from, exactly as built. */
  readonly repo: string
  /** The requested ref, or `default-branch` when none was pinned. */
  readonly ref: string
  /** The commit the clone resolved to. */
  readonly commit: string
  /** When the build finished, as an ISO timestamp. */
  readonly builtAt: string
  /** Absolute path of the built stdio entry. */
  readonly executable: string
  /** The version the built entry reported. */
  readonly version: string
}

/** Options for one source-build installation. */
export interface SourceBuildOptions {
  /** Directory that holds the managed clones; one subdirectory per upstream. */
  readonly root: string
  /** Cancellation for the clone and the build commands. */
  readonly signal?: AbortSignal
  /** Streaming sink for the clone and build output. */
  readonly onOutput?: (chunk: string) => void
  /** Replace an existing install of the same upstream. */
  readonly replace?: boolean
  /**
   * Test-only escape hatch: accept a fixture repository that is not the
   * upstream's declared one. Production callers never set it, so the
   * supply-chain gate stays enforced where a clone reaches the network.
   */
  readonly allowUnofficialSource?: boolean
}

/**
 * Reject a source-build request whose repository is not the one the upstream
 * declares.
 *
 * This is the supply-chain gate the production entry point calls before any
 * byte is cloned: the receipt proves what was built, this check proves the
 * build could only come from the upstream's own repository.
 * @param id - the upstream identity.
 * @param repo - the repository the caller asked to clone.
 * @throws when the repository differs from the upstream record.
 */
export function assertUpstreamSource(id: ExternalRuntimeId, repo: string): void {
  const upstream = EXTERNAL_RUNTIME_UPSTREAMS[id]
  if (upstream === undefined) throw new Error(`unknown external runtime: ${id}`)
  if (repo !== upstream.repo) {
    throw new Error(`${upstream.name} builds only from ${upstream.repo}, received ${repo}`)
  }
}

/**
 * Install one upstream from its own source.
 *
 * The pipeline is clone, dependency install, build, probe, receipt. The probe
 * is the same {@link locateExternalRuntime} the catalog uses, so a finished
 * build registers exactly like an operator-installed runtime: the caller
 * persists `receipt.executable` as the locator's explicit command and the
 * backend row turns ready.
 * @param id - the upstream to build.
 * @param recipe - how the upstream builds from source.
 * @param options - the managed root, cancellation, output sink and replace policy.
 * @returns the receipt whose executable the locator accepts.
 */
export async function installExternalRuntimeFromSource(
  id: ExternalRuntimeId,
  recipe: ExternalRuntimeSourceRecipe,
  options: SourceBuildOptions,
): Promise<SourceBuildReceipt> {
  if (EXTERNAL_RUNTIME_UPSTREAMS[id] === undefined) throw new Error(`unknown external runtime: ${id}`)
  if (options.allowUnofficialSource !== true) assertUpstreamSource(id, recipe.repo)
  if (recipe.install.length === 0) throw new Error('source-build recipe needs an install command')
  const target = join(options.root, id)
  if (options.replace && existsSync(target)) {
    await rm(target, { recursive: true, force: true })
  }
  if (existsSync(target)) {
    throw new Error(`${target} already exists; pass replace to rebuild over it`)
  }
  await mkdir(options.root, { recursive: true })
  await run(['git', 'clone', '--depth', '1', ...(recipe.ref === undefined ? [] : ['--branch', recipe.ref]), '--', recipe.repo, target], options)
  const { stdout: commit } = await exec('git', ['rev-parse', 'HEAD'], { cwd: target, signal: options.signal })
  await run([...recipe.install], { ...options, cwd: target })
  if (recipe.build !== undefined && recipe.build.length > 0) {
    await run([...recipe.build], { ...options, cwd: target })
  }
  const executable = join(target, recipe.executable)
  if (!existsSync(executable)) {
    throw new Error(`source build produced no entry at ${recipe.executable}; the recipe's executable path is stale`)
  }
  const probe: ExternalRuntimeProbe = locateExternalRuntime(id, { command: executable })
  if (!probe.compatible) {
    throw new Error(`the built runtime did not answer a usable probe: ${probe.reason ?? probe.version}`)
  }
  const receipt: SourceBuildReceipt = {
    id,
    repo: recipe.repo,
    ref: recipe.ref ?? 'default-branch',
    commit: commit.trim(),
    builtAt: new Date().toISOString(),
    executable,
    version: probe.version,
  }
  await writeFile(join(target, '.cetusprism-source-build.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  return receipt
}

/** One command run inside the pipeline; failure carries the tail of its output. */
async function run(
  command: readonly string[],
  options: SourceBuildOptions & { cwd?: string },
): Promise<void> {
  const [file, ...args] = command
  if (file === undefined) throw new Error('source-build command is empty')
  const cwd = options.cwd ?? options.root
  const built = spawnStreaming(file, args, cwd, options)
  try {
    await built.done
  } catch (error) {
    if (error instanceof CommandFailure) throw error
    const detail = built.output.tail()
    throw new CommandFailure(`${command.join(' ')} failed in ${cwd}${detail}`, { cause: error })
  }
}

/** A pipeline command whose exit code or launch failed. */
export class CommandFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'CommandFailure'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/**
 * Windows resolves `npm` to npm.cmd, and Node refuses to spawn .cmd shims
 * without a shell; POSIX needs no shell and gains nothing from one.
 */
const commandShell = process.platform === 'win32'

function spawnStreaming(
  file: string,
  args: readonly string[],
  cwd: string,
  options: SourceBuildOptions,
): { done: Promise<void>; output: { tail(): string } } {
  const lines: string[] = []
  const child = spawn(file, args, { cwd, shell: commandShell, signal: options.signal })
  const forward = (chunk: Buffer | string): void => {
    const text = String(chunk)
    lines.push(...text.split(/\r?\n/).filter(line => line.length > 0))
    if (lines.length > 200) lines.splice(0, lines.length - 200)
    options.onOutput?.(text)
  }
  child.stdout?.on('data', forward)
  child.stderr?.on('data', forward)
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, termSignal) => {
      if (code === 0) {
        resolve()
        return
      }
      const ending = termSignal === null ? `exit code ${code}` : `signal ${termSignal}`
      const detail = lines.length === 0 ? '' : `:\n  ${lines.slice(-10).join('\n  ')}`
      reject(new CommandFailure(`${[file, ...args].join(' ')} failed in ${cwd} (${ending})${detail}`))
    })
  })
  return { done, output: { tail: () => lines.length === 0 ? '' : `:\n  ${lines.slice(-10).join('\n  ')}` } }
}
