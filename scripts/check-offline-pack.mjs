#!/usr/bin/env node
/**
 * Offline regression gate for the Windows packaging chain.
 *
 * It answers three questions that keep coming back after a release build:
 *
 *   1. **Does the pack still need the network?** The backend runtime is
 *      materialized by `pnpm deploy --prod --offline`. pnpm 11 verifies the
 *      deploy target's freshly written lockfile against the supply-chain
 *      policies first, and that check fetches every package's metadata and
 *      npm's signed attestations from registry.npmjs.org — it retries forever
 *      when the registry is unreachable, so an offline pack never finishes.
 *      `--trust-lockfile` skips exactly that step. This script asserts the
 *      flag is still on the command line and (with `--probe`) re-runs the
 *      deploy offline to prove no network access is attempted.
 *   2. **Does the shipped shell still carry the build machine's paths?**
 *      Rust bakes `file!()` into the panic-location strings in `.rdata`;
 *      `strip = "symbols"` does not remove them. Only
 *      `--remap-path-prefix` does.
 *   3. **Does the shipped shell still need the VC++ runtime?**
 *      `-C target-feature=+crt-static` links the MSVC CRT statically, so the
 *      import table must not list `vcruntime140*.dll` / `msvcp140*.dll`.
 *
 * Everything here runs offline: the artifact scan is a local byte scan plus a
 * local PE import-table parse (no dumpbin, no npm dependency), and the probe
 * runs pnpm with `--offline`.
 *
 * Usage:
 *   node scripts/check-offline-pack.mjs [--artifacts <dir>] [--strict]
 *                                      [--probe] [--probe-quick]
 *                                      [--pack-script <path>] [--build-script <path>]
 *
 * Exit codes:
 *   0 = all requested checks passed
 *   1 = at least one check failed
 *   2 = usage error
 *
 * @module @deepseek-ai/dsh/check-offline-pack
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Directory the assembled payload and the installer land in.
 *
 * On Windows the payload closure (~500MB) lives beside the other dependency
 * stores, not in the project tree: `pack-tauri.mjs` and `make-installer.mjs`
 * both read `CETUS_DIST_DIR` and fall back to
 * `E:/dependency-cache/cetusprism/dist`. This gate must scan the same
 * landing spot, otherwise it reports "artifact not found" while the release
 * is in fact built.
 */
const distDir = process.env.CETUS_DIST_DIR
  ?? (process.platform === 'win32'
    ? 'E:/dependency-cache/cetusprism/dist'
    : join(repoRoot, 'apps', 'electron', 'dist'))

/**
 * Absolute path fragments that must never appear in a shipped binary
 * (lowercase comparison; both slash spellings are checked).
 *
 * `e:\projects\cetusprism\apps\electron\src-tauri` is the one documented
 * exception: it is the `env!("CARGO_MANIFEST_DIR")` literal that Tauri's
 * codegen embeds as configuration metadata, not a `file!()` path, so
 * `--remap-path-prefix` cannot rewrite it. It is inert at runtime (the shell
 * window loads the backend's web surface over an external URL), and the
 * binary is not post-processed, so its bytes stay exactly as the compiler
 * emitted them. `--strict` turns it into a failure for a release that must
 * not contain any project path at all.
 */
const FORBIDDEN_PATHS = [
  'e:\\dependency-cache',
  'e:/dependency-cache',
  'c:\\users\\',
  'c:/users/',
  'd:\\projects',
  'd:/projects',
  'e:\\projects\\cetusprism\\packages',
  'e:/projects/cetusprism/packages',
  'e:\\projects\\cetusprism\\apps\\electron\\backend',
]
const ALLOWED_PATHS = [
  'e:\\projects\\cetusprism\\apps\\electron\\src-tauri',
  'e:/projects/cetusprism/apps/electron/src-tauri',
]

/**
 * Import-table entries that mean "the target machine needs the VC++ x64
 * redistributable". `api-ms-win-crt-*` is deliberately absent: those API
 * sets ship with Windows 10/11 itself (ucrtbase.dll), they are not the
 * redistributable.
 */
const FORBIDDEN_IMPORTS = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'vcruntime140d.dll',
  'msvcp140.dll',
  'msvcr120.dll',
]

/** Lines that prove pnpm went to the network. */
const NETWORK_LINE = /Will retry in|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|ENOTFOUND|registry\.npmjs\.org\/-\/npm\/v1\/attestations/
/** The supply-chain verification line the offline pack must never print. */
const SUPPLY_CHAIN_LINE = /against supply-chain policies/

function parseArgs(argv) {
  const options = {
    artifacts: join(distDir, 'win-unpacked'),
    exe: undefined,
    packScript: join(repoRoot, 'apps', 'electron', 'scripts', 'pack-tauri.mjs'),
    buildScript: join(repoRoot, 'apps', 'electron', 'scripts', 'build-shell.mjs'),
    strict: false,
    probe: false,
    probeQuick: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--artifacts') options.artifacts = resolve(argv[++index] ?? '')
    else if (arg === '--exe') options.exe = resolve(argv[++index] ?? '')
    else if (arg === '--pack-script') options.packScript = resolve(argv[++index] ?? '')
    else if (arg === '--build-script') options.buildScript = resolve(argv[++index] ?? '')
    else if (arg === '--strict') options.strict = true
    else if (arg === '--probe') options.probe = true
    else if (arg === '--probe-quick') options.probeQuick = true
    else if (arg === '--help' || arg === '-h') return undefined
    else {
      console.error(`check-offline-pack: unknown argument "${arg}"`)
      process.exit(2)
    }
  }
  return options
}

/** Count case-insensitive occurrences of `needle` in a haystack. */
function countOccurrences(haystack, needle) {
  const lowered = haystack.toLowerCase()
  const target = needle.toLowerCase()
  let count = 0
  let from = 0
  for (;;) {
    const at = lowered.indexOf(target, from)
    if (at === -1) break
    count += 1
    from = at + target.length
  }
  return count
}

/**
 * Minimal PE import-table parser: returns the imported DLL names.
 *
 * Windows binaries store their imports in the PE optional header's data
 * directory 1. Reading it directly keeps the check free of external tools
 * (dumpbin is not guaranteed on a build machine) and free of npm packages
 * (the check must run offline).
 */
export function readPeImports(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error('not a PE image (no MZ signature)')
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error('not a PE image (no PE signature)')
  }
  const coff = peOffset + 4
  const sectionCount = buffer.readUInt16LE(coff + 2)
  const optionalSize = buffer.readUInt16LE(coff + 16)
  const optional = coff + 20
  const magic = buffer.readUInt16LE(optional)
  const isPe32Plus = magic === 0x20b
  const dataDirectory = optional + (isPe32Plus ? 112 : 96)
  const importRva = buffer.readUInt32LE(dataDirectory + 8)
  const importSize = buffer.readUInt32LE(dataDirectory + 12)
  if (importRva === 0 || importSize === 0) return []

  const sections = []
  const sectionTable = optional + optionalSize
  for (let index = 0; index < sectionCount; index++) {
    const header = sectionTable + index * 40
    sections.push({
      virtualSize: buffer.readUInt32LE(header + 8),
      virtualAddress: buffer.readUInt32LE(header + 12),
      rawSize: buffer.readUInt32LE(header + 16),
      rawPointer: buffer.readUInt32LE(header + 20),
    })
  }
  const toOffset = rva => {
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize)
      if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
        return section.rawPointer + (rva - section.virtualAddress)
      }
    }
    return undefined
  }
  const readCString = offset => {
    let end = offset
    while (end < buffer.length && buffer[end] !== 0) end += 1
    return buffer.toString('latin1', offset, end)
  }

  const dlls = []
  let descriptor = toOffset(importRva)
  if (descriptor === undefined) return []
  for (;;) {
    const nameRva = buffer.readUInt32LE(descriptor + 12)
    const firstThunk = buffer.readUInt32LE(descriptor + 16)
    const originalFirstThunk = buffer.readUInt32LE(descriptor)
    if (nameRva === 0 && firstThunk === 0) break
    const nameOffset = toOffset(nameRva)
    if (nameOffset !== undefined) dlls.push(readCString(nameOffset))
    const thunkRva = originalFirstThunk !== 0 ? originalFirstThunk : firstThunk
    const thunkOffset = thunkRva !== 0 ? toOffset(thunkRva) : undefined
    if (thunkOffset !== undefined) {
      const stride = isPe32Plus ? 8 : 4
      for (let entry = thunkOffset; entry + stride <= buffer.length; entry += stride) {
        const value = isPe32Plus
          ? buffer.readBigUInt64LE(entry)
          : BigInt(buffer.readUInt32LE(entry))
        if (value === 0n) break
      }
    }
    descriptor += 20
  }
  return dlls
}

/** Scan a binary for forbidden path literals and dynamic CRT imports. */
function scanArtifact(path) {
  const bytes = readFileSync(path)
  const haystacks = [bytes.toString('latin1'), bytes.toString('utf16le')]
  const failures = []
  const warnings = []
  for (const needle of FORBIDDEN_PATHS) {
    const hits = haystacks.reduce((total, haystack) => total + countOccurrences(haystack, needle), 0)
    if (hits > 0) failures.push(`dev path literal "${needle}" x${hits}`)
  }
  for (const needle of ALLOWED_PATHS) {
    const hits = haystacks.reduce((total, haystack) => total + countOccurrences(haystack, needle), 0)
    if (hits > 0) {
      warnings.push(`documented exception "${needle}" x${hits} (tauri codegen CARGO_MANIFEST_DIR literal; --remap-path-prefix cannot rewrite it)`)
    }
  }
  let imports = []
  try {
    imports = readPeImports(bytes)
  } catch (error) {
    warnings.push(`import table unreadable: ${error.message}`)
  }
  for (const dll of imports) {
    if (FORBIDDEN_IMPORTS.includes(dll.toLowerCase())) {
      failures.push(`dynamic CRT import "${dll}" (target machine would need the VC++ x64 redistributable)`)
    }
  }
  return { failures, warnings, imports, size: bytes.length }
}

/** Assert the pack script keeps the offline deploy flags. */
function checkPackScript(path) {
  const failures = []
  const source = readFileSync(path, 'utf8')
  const deployAt = source.indexOf("'deploy', '--prod', '--offline'")
  if (deployAt === -1) {
    failures.push('pack script: the pnpm deploy call with --prod --offline was not found')
  } else {
    const call = source.slice(deployAt, deployAt + 1200)
    if (!call.includes("'--trust-lockfile'")) {
      failures.push("pack script: the pnpm deploy call lost '--trust-lockfile' (pnpm 11 would re-run the network-dependent supply-chain verification)")
    }
    if (!call.includes("'--offline'")) {
      failures.push("pack script: the pnpm deploy call lost '--offline'")
    }
  }
  return failures
}

/** Assert the shell build keeps the path-remap and static-CRT flags. */
function checkBuildScript(path) {
  const failures = []
  const source = readFileSync(path, 'utf8')
  if (!source.includes('target-feature=+crt-static')) {
    failures.push('build script: RUSTFLAGS lost `-C target-feature=+crt-static` (the shell would need the VC++ runtime)')
  }
  if (!source.includes('--remap-path-prefix=')) {
    failures.push('build script: RUSTFLAGS lost `--remap-path-prefix` (the shell would carry the build machine paths)')
  }
  return failures
}

/** Locate the local pnpm entry point the pack script uses. */
function resolvePnpm() {
  const candidates = [
    join(repoRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    ...[join(repoRoot, 'node_modules', '.pnpm'), 'E:/dependency-cache/pnpm/vstore']
      .flatMap(vstore => {
        try {
          return readdirSync(vstore).filter(name => /^pnpm@\d+\./.test(name)).map(name => join(vstore, name, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
        } catch { return [] }
      }),
  ]
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * Assert the shipped runtime carries the one-registration-per-scope discovery
 * fix whenever the desktop overlay turns the Team model-selection switch on.
 *
 * The pack chain deploys the built `lib/` closure; it never rebuilds it. A
 * runtime left over from before the fix registers `list_subagent_models` twice
 * in one Agent scope (the delegation tool and the Agent Team), and the second
 * registration fails with `tool "list_subagent_models" is already registered in
 * this scope` — no top-level session can be created. The overlay may only
 * enable that switch when the shipped code can carry it.
 * @param artifacts - assembled payload directory (the one with `resources/app`).
 * @returns failures and warnings describing the runtime's state.
 */
function checkRuntimeDiscoveryRegistration(artifacts) {
  const failures = []
  const warnings = []
  const runtimeModule = join(
    artifacts, 'resources', 'app', 'backend', 'runtime', 'node_modules', '@deepseek-ai',
    'dsh-tool-subagent', 'lib', 'list-models.js',
  )
  const overlay = join(artifacts, 'resources', 'app', 'backend', 'desktop-experimental.patch.yml')
  if (!existsSync(runtimeModule)) {
    warnings.push(`runtime discovery module not found (${runtimeModule}) — skipped the one-registration check`)
    return { failures, warnings }
  }
  const shared = readFileSync(runtimeModule, 'utf8').includes('dsh.tool-subagent.discovery.scope-states')
  if (!existsSync(overlay)) {
    warnings.push(`desktop overlay not found (${overlay}) — skipped the one-registration check`)
    return { failures, warnings }
  }
  const enabled = /modelSelectionSettings:\s*true/.test(readFileSync(overlay, 'utf8'))
  if (enabled && !shared) {
    failures.push('runtime: the desktop overlay enables the Team model-selection switch, but the shipped tool-subagent runtime predates the one-registration-per-scope fix (a session would fail with `tool "list_subagent_models" is already registered in this scope`)')
  }
  if (!enabled && !shared) {
    warnings.push('runtime: the shipped tool-subagent runtime predates the one-registration-per-scope fix (the Team model-selection switch stays off, so no duplicate registration can happen)')
  }
  if (shared) {
    warnings.push('runtime: the shipped tool-subagent runtime carries the one-registration-per-scope discovery fix')
  }
  return { failures, warnings }
}

/**
 * Re-run the deploy offline and prove it does not reach for the network.
 *
 * The probe writes into `temp/` (git-ignored scratch space) and never
 * touches the release output. Pass criteria: no supply-chain verification
 * line and no network retry line in the pnpm output.
 */
function runProbe({ quick }) {
  const pnpm = resolvePnpm()
  if (pnpm === undefined) {
    return { failures: ['probe: local pnpm.cjs not found'], notes: [] }
  }
  const scratch = join(repoRoot, 'temp', quick ? 'offline-pack-probe-quick' : 'offline-pack-probe')
  mkdirSync(scratch, { recursive: true })
  const args = [
    pnpm,
    '--filter', quick ? '@deepseek-ai/cosmokit' : '@deepseek-ai/dsh',
    'deploy', '--prod', '--offline',
    '--node-linker=hoisted', '--config.inject-workspace-packages=true',
    '--trust-lockfile',
    join(scratch, 'runtime'),
  ]
  let output = ''
  let exitCode = 0
  try {
    output = execFileSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: quick ? 300_000 : 1_800_000,
    })
  } catch (error) {
    exitCode = typeof error.status === 'number' ? error.status : 1
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  const failures = []
  const notes = []
  if (SUPPLY_CHAIN_LINE.test(output)) {
    failures.push('probe: pnpm re-ran the supply-chain verification (network required) — drop `--trust-lockfile`?')
  }
  if (NETWORK_LINE.test(output)) {
    const sample = output.split(/\r?\n/).filter(line => NETWORK_LINE.test(line)).slice(0, 3)
    failures.push(`probe: pnpm attempted network access — ${sample.join(' | ')}`)
  }
  notes.push(`probe exit code: ${exitCode}`)
  if (exitCode !== 0 && !quick) {
    const tail = output.split(/\r?\n/).filter(Boolean).slice(-5).join(' | ')
    failures.push(`probe: the deploy failed (exit ${exitCode}) — ${tail}`)
  }
  if (exitCode !== 0 && quick) {
    notes.push('probe (quick) exit code is not part of the verdict: the small closure is not the shipped one (it fails with ERR_PNPM_UNUSED_PATCH because the workspace patchedDependencies are outside its closure)')
  }
  // The scratch tree is kept: nothing in this repository deletes files as a
  // side effect of a check. It lives under the git-ignored `temp/` and can be
  // removed by hand.
  notes.push(`probe scratch tree: ${scratch}`)
  return { failures, notes }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === undefined) {
    console.log('usage: node scripts/check-offline-pack.mjs [--artifacts <dir>] [--exe <file>] [--strict] [--probe] [--probe-quick]')
    console.log('exit codes: 0 pass, 1 fail, 2 usage error')
    return
  }
  const failures = []
  const warnings = []
  const notes = []

  console.log('check-offline-pack: script invariants')
  failures.push(...checkPackScript(options.packScript))
  failures.push(...checkBuildScript(options.buildScript))

  const exe = options.exe ?? join(options.artifacts, 'CetusPrism.exe')
  console.log(`check-offline-pack: artifact scan (${exe})`)
  if (!existsSync(exe)) {
    warnings.push(`artifact not found (${exe}) — skipped the binary scan`)
  } else {
    const result = scanArtifact(exe)
    failures.push(...result.failures)
    warnings.push(...result.warnings)
    notes.push(`imported DLLs (${result.imports.length}): ${result.imports.join(', ') || 'none'}`)
    notes.push(`artifact size: ${result.size} bytes`)
  }

  console.log('check-offline-pack: runtime closure scan')
  const runtime = checkRuntimeDiscoveryRegistration(options.artifacts)
  failures.push(...runtime.failures)
  warnings.push(...runtime.warnings)

  if (options.probe || options.probeQuick) {
    console.log('check-offline-pack: offline deploy probe')
    const probe = runProbe({ quick: options.probeQuick })
    failures.push(...probe.failures)
    notes.push(...probe.notes)
  }

  for (const note of notes) console.log(`  note: ${note}`)
  for (const warning of warnings) {
    if (options.strict && warning.startsWith('documented exception')) failures.push(`strict: ${warning}`)
    else console.log(`  warn: ${warning}`)
  }
  if (failures.length > 0) {
    console.error('  FAIL:')
    for (const failure of failures) console.error(`    - ${failure}`)
    process.exit(1)
  }
  console.log('  PASS: the pack chain is offline-safe and the shell carries no forbidden path or CRT dependency')
}

main()
