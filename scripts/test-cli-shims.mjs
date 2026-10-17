#!/usr/bin/env node
/**
 * Regression for the installed cmd CLI launcher. A scratch installation with
 * spaces in every directory is put on a child-only PATH, so a bare `dsh` in
 * cmd must resolve the launcher, forward `tui` plus a quoted spaced argument
 * to the CLI entry, and propagate the entry's exit code.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCliShims } from './cli-shims.mjs'

if (process.platform !== 'win32') throw new Error('This check requires Windows cmd')

const scratchRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'temp')
mkdirSync(scratchRoot, { recursive: true })
const scratch = mkdtempSync(join(scratchRoot, 'cli-shims-'))
try {
  const install = join(scratch, 'install dir with spaces')
  const backend = join(install, 'resources', 'app', 'backend')
  const runtime = join(backend, 'runtime', 'lib')
  const binDir = join(install, 'bin')
  const workingDir = join(scratch, 'working dir with spaces')
  const spacedTarget = join(scratch, 'target dir with spaces', 'tui target.txt')
  mkdirSync(runtime, { recursive: true })
  mkdirSync(workingDir, { recursive: true })
  copyFileSync(process.execPath, join(backend, 'node.exe'))
  writeFileSync(
    join(runtime, 'bin.js'),
    [
      'const forwarded = JSON.stringify(process.argv.slice(2))',
      'console.log(forwarded)',
      'process.exitCode = Number(process.env.DSH_TEST_CLI_EXIT ?? 0)',
      '',
    ].join('\n'),
  )
  writeCliShims(binDir)

  const cmdText = readFileSync(join(binDir, 'dsh.cmd'), 'utf8')
  assert.ok(cmdText.endsWith('\r\n'), 'dsh.cmd must end with a physical CRLF')
  assert.equal(
    cmdText.replace(/[^\n]/g, '').length,
    cmdText.replace(/[^\r]/g, '').length,
    'dsh.cmd must use CRLF for every line break',
  )
  assert.ok(!cmdText.includes('\\r\\n'), 'dsh.cmd must not contain literal backslash-r sequences')
  const shText = readFileSync(join(binDir, 'dsh'), 'utf8')
  assert.ok(!shText.includes('\r'), 'dsh must use LF-only line endings')
  assert.ok(shText.endsWith('\n'), 'dsh must end with a newline')
  assert.ok(!shText.includes('\\n'), 'dsh must not contain literal backslash-n sequences')

  const childEnv = { ...process.env, PATH: `${binDir};${process.env.PATH ?? ''}` }
  const run = (command, extraEnv = {}) =>
    spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
      cwd: workingDir,
      env: { ...childEnv, ...extraEnv },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      windowsVerbatimArguments: true,
    })

  const forwardedRun = run(`dsh tui "${spacedTarget}"`)
  assert.ifError(forwardedRun.error)
  assert.equal(forwardedRun.status, 0, `dsh exited ${forwardedRun.status}: ${forwardedRun.stderr}`)
  assert.deepEqual(JSON.parse(forwardedRun.stdout), ['tui', spacedTarget])

  const exitRun = run('dsh', { DSH_TEST_CLI_EXIT: '7' })
  assert.ifError(exitRun.error)
  assert.equal(exitRun.status, 7, `dsh did not propagate exit code 7 (got ${exitRun.status})`)

  console.log('cmd launcher PATH resolution and argument forwarding: passed')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
